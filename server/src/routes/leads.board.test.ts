import "dotenv/config";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { Lead, type Stage } from "../models/Lead.js";
import type { Role } from "../models/User.js";
import { signToken } from "../lib/jwt.js";
import { skipTenant } from "../lib/tenantPlugin.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

describe("pipeline board", () => {
  let safe = false;
  let a: string;
  let b: string;

  const tokenFor = (brokerageId: string | null, role: Role = "advisor") =>
    signToken({
      id: new mongoose.Types.ObjectId().toString(),
      role,
      brokerageId,
    });
  const mk = async (brokerageId: string, name: string, stage: Stage = "new") =>
    await Lead.create({
      brokerageId: new mongoose.Types.ObjectId(brokerageId),
      name,
      email: `${name.toLowerCase()}@example.de`,
      stage,
    });
  const list = (token: string) =>
    request(app).get("/api/leads").set("Authorization", `Bearer ${token}`);
  const move = (token: string, leadId: string, body: object) =>
    request(app)
      .patch(`/api/leads/${leadId}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const stored = async (id: string) => await skipTenant(Lead.findById(id));

  before(async () => {
    if (!TEST_URI)
      throw new Error(
        'Set MONGODB_URI_TEST in server/.env (database name must contain "test")',
      );
    await mongoose.connect(TEST_URI);
    if (!mongoose.connection.name.includes("test")) {
      await mongoose.disconnect();
      throw new Error(
        `Refusing to run: database "${mongoose.connection.name}" does not look like a test DB`,
      );
    }
    safe = true;
    await mongoose.connection.dropDatabase();
    await Lead.syncIndexes();

    const [brokerageA, brokerageB] = await Brokerage.create([
      { name: "A" },
      { name: "B" },
    ]);
    a = brokerageA.id;
    b = brokerageB.id;
  });

  beforeEach(async () => {
    await skipTenant(Lead.deleteMany({}));
  });

  after(async () => {
    if (safe) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describe("listing", () => {
    it("returns only the caller's tenant, and never the idempotency key", async () => {
      await mk(a, "Anna");
      await mk(a, "Ben");
      await mk(b, "Zoe");
      const res = await list(tokenFor(a));
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.body.leads.map((l: { name: string }) => l.name).sort(),
        ["Anna", "Ben"],
      );
      assert.equal(res.body.leads[0].version, 0);
      assert.equal("idempotencyKey" in res.body.leads[0], false);
    });

    it("is closed to clients, platform admins and anonymous callers", async () => {
      assert.equal((await list(tokenFor(a, "client"))).status, 403);
      assert.equal((await list(tokenFor(null, "platform_admin"))).status, 403);
      assert.equal((await request(app).get("/api/leads")).status, 401);
    });
  });

  describe("stage moves", () => {
    it("moves a lead and bumps its version", async () => {
      const lead = await mk(a, "Anna");
      const res = await move(tokenFor(a), lead.id, {
        stage: "contacted",
        version: 0,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.lead.stage, "contacted");
      assert.equal(res.body.lead.version, 1);
      assert.equal((await stored(lead.id))?.stage, "contacted");
    });

    it("rejects a stale version with 409 and the current state, applying nothing", async () => {
      const lead = await mk(a, "Anna");
      await move(tokenFor(a), lead.id, { stage: "contacted", version: 0 });

      const res = await move(tokenFor(a), lead.id, {
        stage: "qualified",
        version: 0,
      });
      assert.equal(res.status, 409);
      assert.equal(res.body.lead.stage, "contacted");
      assert.equal(res.body.lead.version, 1);
      const fresh = await stored(lead.id);
      assert.equal(fresh?.stage, "contacted");
      assert.equal(fresh?.version, 1);
    });

    it("two advisors moving the same lead at once: exactly one wins", async () => {
      const lead = await mk(a, "Anna");
      const [r1, r2] = await Promise.all([
        move(tokenFor(a), lead.id, { stage: "contacted", version: 0 }),
        move(tokenFor(a), lead.id, { stage: "qualified", version: 0 }),
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);

      const [winner, loser] = r1.status === 200 ? [r1, r2] : [r2, r1];
      const fresh = await stored(lead.id);
      assert.equal(fresh?.version, 1);
      assert.equal(fresh?.stage, winner.body.lead.stage);
      assert.equal(loser.body.lead.version, 1); // the loser is told the current state
    });

    it("treats a move to the current stage as a no-op without bumping the version", async () => {
      const lead = await mk(a, "Anna");
      const res = await move(tokenFor(a), lead.id, {
        stage: "new",
        version: 0,
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.lead.version, 0);
    });

    it("cross-tenant ID guess returns 404 and changes nothing", async () => {
      const lead = await mk(a, "Anna");
      const res = await move(tokenFor(b), lead.id, {
        stage: "won",
        version: 0,
      });
      assert.equal(res.status, 404);
      const fresh = await stored(lead.id);
      assert.equal(fresh?.stage, "new");
      assert.equal(fresh?.version, 0);
    });

    it("validates the stage enum, the version and the id", async () => {
      const lead = await mk(a, "Anna");
      assert.equal(
        (await move(tokenFor(a), lead.id, { stage: "banana", version: 0 }))
          .status,
        400,
      );
      assert.equal(
        (await move(tokenFor(a), lead.id, { stage: "won" })).status,
        400,
      );
      assert.equal(
        (await move(tokenFor(a), "not-an-id", { stage: "won", version: 0 }))
          .status,
        404,
      );
    });

    it("is closed to clients and anonymous callers", async () => {
      const lead = await mk(a, "Anna");
      assert.equal(
        (
          await move(tokenFor(a, "client"), lead.id, {
            stage: "won",
            version: 0,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(app)
            .patch(`/api/leads/${lead.id}/stage`)
            .send({ stage: "won", version: 0 })
        ).status,
        401,
      );
    });
  });
});
