import "dotenv/config";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { Client } from "../models/Client.js";
import { Lead } from "../models/Lead.js";
import { User, type Role } from "../models/User.js";
import { signToken } from "../lib/jwt.js";
import { skipTenant } from "../lib/tenantPlugin.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

describe("lead conversion and client portal", () => {
  let safe = false;
  let a: string;
  let b: string;
  let advisorId: string;
  let counter = 0;

  const advisorToken = () =>
    signToken({ id: advisorId, role: "advisor", brokerageId: a });
  const tokenFor = (brokerageId: string, role: Role = "advisor") =>
    signToken({
      id: new mongoose.Types.ObjectId().toString(),
      role,
      brokerageId,
    });

  const mkLead = async (brokerageId: string, name: string) => {
    counter += 1;
    return await Lead.create({
      brokerageId: new mongoose.Types.ObjectId(brokerageId),
      name,
      email: `lead${counter}@lead.test`,
      phone: `+4915100${String(counter).padStart(6, "0")}`,
    });
  };
  const convert = (token: string, leadId: string, body: object) =>
    request(app)
      .post(`/api/leads/${leadId}/convert`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const move = (token: string, leadId: string, body: object) =>
    request(app)
      .patch(`/api/leads/${leadId}/stage`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  const login = (email: string, password: string) =>
    request(app).post("/api/auth/login").send({ email, password });
  const stored = async (id: string) => await skipTenant(Lead.findById(id));
  const counts = async () => ({
    clients: await skipTenant(Client.countDocuments({})),
    portalUsers: await skipTenant(User.countDocuments({ role: "client" })),
  });

  // Converts a lead and returns the client's own login token.
  const onboard = async (
    brokerageId: string,
    name: string,
    email: string,
    byToken: string,
  ) => {
    const lead = await mkLead(brokerageId, name);
    const res = await convert(byToken, lead.id, { version: 0, email });
    assert.equal(res.status, 201);
    const session = await login(email, res.body.portal.temporaryPassword);
    assert.equal(session.status, 200);
    return session.body.token as string;
  };
  const portal = (token: string) =>
    request(app)
      .get("/api/portal/case")
      .set("Authorization", `Bearer ${token}`);

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
    // dropDatabase removed the unique indexes (lead once, email once) that these tests rely on.
    await Lead.syncIndexes();
    await Client.syncIndexes();
    await User.syncIndexes();

    const [brokerageA, brokerageB] = await Brokerage.create([
      { name: "A" },
      { name: "B" },
    ]);
    a = brokerageA.id;
    b = brokerageB.id;
    const advisor = await new User({
      name: "Max Advisor",
      email: "advisor@fixture.test",
      role: "advisor",
      brokerageId: a,
      passwordHash: "x",
    }).save();
    advisorId = advisor.id;
  });

  beforeEach(async () => {
    await skipTenant(Lead.deleteMany({}));
    await skipTenant(Client.deleteMany({}));
    await skipTenant(User.deleteMany({ email: { $not: /@fixture\.test$/ } })); // keeps only the advisor fixture
  });

  after(async () => {
    if (safe) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describe("conversion", () => {
    it("creates the client and a working portal login, and marks the lead won", async () => {
      const lead = await mkLead(a, "Anna Beispiel");
      const res = await convert(advisorToken(), lead.id, {
        version: 0,
        email: "Anna@Portal.test",
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.lead.stage, "won");
      assert.equal(res.body.lead.version, 1);
      assert.ok(res.body.lead.clientId);

      const client = await skipTenant(Client.findOne({ leadId: lead.id }));
      assert.ok(client);
      assert.equal(String(client.brokerageId), a);
      assert.equal(String(client.advisorId), advisorId);
      assert.equal(client.name, "Anna Beispiel");

      const user = await skipTenant(
        User.findOne({ email: "anna@portal.test" }),
      );
      assert.equal(user?.role, "client");
      assert.equal(String(user?.brokerageId), a);

      const session = await login(
        "anna@portal.test",
        res.body.portal.temporaryPassword,
      );
      assert.equal(session.status, 200);
      assert.equal(session.body.user.role, "client");
    });

    it("a lead converts only once", async () => {
      const lead = await mkLead(a, "Anna Beispiel");
      assert.equal(
        (
          await convert(advisorToken(), lead.id, {
            version: 0,
            email: "anna@portal.test",
          })
        ).status,
        201,
      );

      const again = await convert(advisorToken(), lead.id, {
        version: 1,
        email: "other@portal.test",
      });
      assert.equal(again.status, 409);
      assert.match(again.body.error, /already a client/);
      assert.deepEqual(await counts(), { clients: 1, portalUsers: 1 });
    });

    it("two advisors converting at once: exactly one wins", async () => {
      const lead = await mkLead(a, "Anna Beispiel");
      const [r1, r2] = await Promise.all([
        convert(advisorToken(), lead.id, {
          version: 0,
          email: "one@portal.test",
        }),
        convert(advisorToken(), lead.id, {
          version: 0,
          email: "two@portal.test",
        }),
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [201, 409]);
      assert.deepEqual(await counts(), { clients: 1, portalUsers: 1 });
    });

    it("a stale version is rejected and creates nothing", async () => {
      const lead = await mkLead(a, "Anna Beispiel");
      await move(advisorToken(), lead.id, { stage: "contacted", version: 0 });

      const res = await convert(advisorToken(), lead.id, {
        version: 0,
        email: "anna@portal.test",
      });
      assert.equal(res.status, 409);
      assert.match(res.body.error, /changed by someone else/);
      assert.deepEqual(await counts(), { clients: 0, portalUsers: 0 });
      assert.equal((await stored(lead.id))?.clientId, undefined);
    });

    it("rolls everything back when the login email is already taken", async () => {
      await new User({
        name: "Existing",
        email: "taken@portal.test",
        role: "advisor",
        brokerageId: b, // another brokerage: the error must not reveal that
        passwordHash: "x",
      }).save();
      const lead = await mkLead(a, "Anna Beispiel");

      const res = await convert(advisorToken(), lead.id, {
        version: 0,
        email: "taken@portal.test",
      });
      assert.equal(res.status, 409);
      assert.match(res.body.error, /cannot be used/);

      const fresh = await stored(lead.id);
      assert.equal(fresh?.clientId, undefined); // the lead update was rolled back
      assert.equal(fresh?.stage, "new");
      assert.equal(fresh?.version, 0);
      assert.equal((await counts()).clients, 0);
    });

    it("cross-tenant ID guess returns 404 and creates nothing", async () => {
      const lead = await mkLead(a, "Anna Beispiel");
      const res = await convert(tokenFor(b), lead.id, {
        version: 0,
        email: "anna@portal.test",
      });
      assert.equal(res.status, 404);
      assert.deepEqual(await counts(), { clients: 0, portalUsers: 0 });
      assert.equal((await stored(lead.id))?.version, 0);
    });

    it("validates the email and is closed to clients", async () => {
      const lead = await mkLead(a, "Anna Beispiel");
      assert.equal(
        (await convert(advisorToken(), lead.id, { version: 0, email: "nope" }))
          .status,
        400,
      );
      assert.equal(
        (
          await convert(tokenFor(a, "client"), lead.id, {
            version: 0,
            email: "x@portal.test",
          })
        ).status,
        403,
      );
    });

    it("a converted lead cannot be moved", async () => {
      const lead = await mkLead(a, "Anna Beispiel");
      await convert(advisorToken(), lead.id, {
        version: 0,
        email: "anna@portal.test",
      });

      const res = await move(advisorToken(), lead.id, {
        stage: "lost",
        version: 1,
      });
      assert.equal(res.status, 422);
      assert.equal((await stored(lead.id))?.stage, "won");
    });
  });

  describe("client portal", () => {
    it("each client sees only their own case", async () => {
      const annaToken = await onboard(
        a,
        "Anna Beispiel",
        "anna@portal.test",
        advisorToken(),
      );
      const benToken = await onboard(
        a,
        "Ben Beispiel",
        "ben@portal.test",
        advisorToken(),
      );

      const anna = await portal(annaToken);
      assert.equal(anna.status, 200);
      assert.equal(anna.body.case.name, "Anna Beispiel");
      assert.equal(anna.body.case.advisor.name, "Max Advisor");
      assert.equal((await portal(benToken)).body.case.name, "Ben Beispiel");
    });

    it("a client of another brokerage sees their own case", async () => {
      const zoeToken = await onboard(
        b,
        "Zoe Beispiel",
        "zoe@portal.test",
        tokenFor(b),
      );
      const res = await portal(zoeToken);
      assert.equal(res.status, 200);
      assert.equal(res.body.case.name, "Zoe Beispiel");
    });

    it("a token claiming another brokerage finds nothing", async () => {
      await onboard(a, "Anna Beispiel", "anna@portal.test", advisorToken());
      const user = await skipTenant(
        User.findOne({ email: "anna@portal.test" }),
      );
      assert.ok(user);

      const forged = signToken({ id: user.id, role: "client", brokerageId: b });
      assert.equal((await portal(forged)).status, 404);
    });

    it("is closed to staff and anonymous callers", async () => {
      assert.equal((await portal(advisorToken())).status, 403);
      assert.equal((await request(app).get("/api/portal/case")).status, 401);
    });
  });
});
