import "dotenv/config";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import request from "supertest";
import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { User, type Role } from "../models/User.js";
import { signToken } from "./jwt.js";
import { tenantStorage } from "./tenantContext.js";
import { TenantError, skipTenant } from "./tenantPlugin.js";

const TEST_URI = process.env.MONGODB_URI_TEST;
const PASSWORD = "Test-pass-123!";

// Runs fn inside a tenant context. The await INSIDE run() matters: queries execute on await,
// so awaiting outside the callback would run the hook without a context.
const as = <T>(
  brokerageId: string | null,
  role: Role,
  fn: () => PromiseLike<T>,
) => tenantStorage.run({ brokerageId, role }, async () => await fn());

describe("tenant scoping", () => {
  let safe = false;
  let a: string; // brokerage A id
  let b: string; // brokerage B id
  let advisorA: string;

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

    const [brokerageA, brokerageB] = await Brokerage.create([
      { name: "A" },
      { name: "B" },
    ]);
    a = brokerageA.id;
    b = brokerageB.id;
    const passwordHash = await bcrypt.hash(PASSWORD, 4);
    const mk = (
      name: string,
      email: string,
      role: Role,
      brokerageId: string | null,
    ) => new User({ name, email, role, brokerageId, passwordHash }).save();

    advisorA = (await mk("Advisor A", "advisor-a@test.dev", "advisor", a)).id;
    await mk("Advisor B", "advisor-b@test.dev", "advisor", b);
    await mk("Root", "root@test.dev", "platform_admin", null);
  });

  after(async () => {
    if (safe) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describe("queries", () => {
    it("cross-tenant ID guess returns nothing", async () => {
      const hit = await as(b, "advisor", () => User.findById(advisorA));
      assert.equal(hit, null);
    });

    it("same-tenant lookup still works (control)", async () => {
      const hit = await as(a, "advisor", () => User.findById(advisorA));
      assert.equal(hit?.id, advisorA);
    });

    it("a caller-supplied brokerageId filter cannot reach another tenant", async () => {
      const docs = await as(b, "advisor", () => User.find({ brokerageId: a }));
      assert.ok(docs.length > 0);
      assert.ok(docs.every((d) => d.brokerageId?.toString() === b));
    });

    it("cross-tenant update and delete affect nothing", async () => {
      const upd = await as(b, "advisor", () =>
        User.updateOne({ _id: advisorA }, { $set: { name: "hacked" } }),
      );
      const del = await as(b, "advisor", () =>
        User.deleteOne({ _id: advisorA }),
      );
      assert.equal(upd.matchedCount, 0);
      assert.equal(del.deletedCount, 0);
      const fresh = await skipTenant(User.findById(advisorA));
      assert.equal(fresh?.name, "Advisor A");
    });

    it("moving a record to another tenant is rejected", async () => {
      await assert.rejects(
        as(a, "advisor", () =>
          User.updateOne({ _id: advisorA }, { $set: { brokerageId: b } }),
        ),
        TenantError,
      );
    });

    it("platform admin sees every tenant", async () => {
      const docs = await as(null, "platform_admin", () => User.find());
      const tenants = new Set(docs.map((d) => String(d.brokerageId)));
      assert.ok(tenants.has(a) && tenants.has(b));
    });
  });

  describe("fail closed", () => {
    it("rejects a scoped query with no tenant context", async () => {
      await assert.rejects(User.findById(advisorA).exec(), TenantError);
    });

    it("skipTenant is the explicit opt-out", async () => {
      const hit = await skipTenant(
        User.findOne({ email: "advisor-a@test.dev" }),
      );
      assert.equal(hit?.id, advisorA);
    });
  });

  describe("aggregate", () => {
    it("is scoped to the caller tenant", async () => {
      const rows = await as(b, "advisor", () =>
        User.aggregate([{ $group: { _id: "$brokerageId", n: { $sum: 1 } } }]),
      );
      assert.equal(rows.length, 1);
      assert.equal(String(rows[0]._id), b);
    });

    it("refuses cross-collection stages", async () => {
      await assert.rejects(
        as(b, "advisor", () =>
          User.aggregate([
            {
              $lookup: {
                from: "brokerages",
                localField: "brokerageId",
                foreignField: "_id",
                as: "x",
              },
            },
          ]),
        ),
        TenantError,
      );
    });
  });

  describe("inserts", () => {
    it("takes the caller tenant and refuses another one", async () => {
      const mine = new User({
        name: "New",
        email: "new-a@test.dev",
        role: "advisor",
        passwordHash: "x",
      });
      await as(a, "advisor", async () => mine.save());
      assert.equal(mine.brokerageId?.toString(), a);

      const foreign = new User({
        name: "Foreign",
        email: "new-x@test.dev",
        role: "advisor",
        passwordHash: "x",
        brokerageId: b,
      });
      await assert.rejects(
        as(a, "advisor", async () => foreign.save()),
        TenantError,
      );
    });
  });

  describe("over HTTP (context survives the Express chain)", () => {
    it("login works with no tenant context", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: "advisor-a@test.dev", password: PASSWORD });
      assert.equal(res.status, 200);
      assert.equal(typeof res.body.token, "string");
    });

    it("/me returns the user through the scoped query", async () => {
      const token = signToken({
        id: advisorA,
        role: "advisor",
        brokerageId: a,
      });
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, "advisor-a@test.dev");
    });

    it("/me is 401 when the token tenant does not own the user", async () => {
      const token = signToken({
        id: advisorA,
        role: "advisor",
        brokerageId: b,
      });
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      assert.equal(res.status, 401);
    });
  });
});
