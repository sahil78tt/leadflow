import "dotenv/config";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { Client } from "../models/Client.js";
import { Lead, type Stage } from "../models/Lead.js";
import { User } from "../models/User.js";
import { setCache, type CacheStore } from "../lib/cache.js";
import { signToken } from "../lib/jwt.js";
import { skipTenant } from "../lib/tenantPlugin.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

class MemoryStore implements CacheStore {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async incr(key: string) {
    const next = Number(this.data.get(key) ?? 0) + 1;
    this.data.set(key, String(next));
    return next;
  }
}

// Lands an invalidation BETWEEN a request's cache read and its cache write (the classic stale-write race).
class RacyStore extends MemoryStore {
  armed = false;
  override async get(key: string) {
    const value = await super.get(key);
    if (this.armed && key.startsWith("dash:pipeline:") && value === null) {
      this.armed = false;
      await this.incr(
        key.replace("dash:pipeline:", "dash:epoch:").replace(/:\d+$/, ""),
      );
    }
    return value;
  }
}

class BrokenStore implements CacheStore {
  async get(): Promise<string | null> {
    throw new Error("redis down");
  }
  async set(): Promise<void> {
    throw new Error("redis down");
  }
  async incr(): Promise<number> {
    throw new Error("redis down");
  }
}

describe("dashboard cache", () => {
  let safe = false;
  let a: string;
  let b: string;
  let counter = 0;

  const staff = (brokerageId: string) =>
    signToken({
      id: new Types.ObjectId().toString(),
      role: "advisor",
      brokerageId,
    });
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const dash = (token: string) =>
    request(app).get("/api/dashboard").set(auth(token));
  const mkLead = async (brokerageId: string, stage: Stage = "new") => {
    counter += 1;
    return await Lead.create({
      brokerageId: new Types.ObjectId(brokerageId),
      name: `Lead ${counter}`,
      email: `lead${counter}@lead.test`,
      stage,
    });
  };
  const move = (token: string, id: string, body: object) =>
    request(app).patch(`/api/leads/${id}/stage`).set(auth(token)).send(body);

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
    await Client.syncIndexes();
    await User.syncIndexes();

    const [brokerageA, brokerageB] = await Brokerage.create([
      { name: "A" },
      { name: "B" },
    ]);
    a = brokerageA.id;
    b = brokerageB.id;
  });

  beforeEach(async () => {
    await skipTenant(Lead.deleteMany({}));
    await skipTenant(Client.deleteMany({}));
    await skipTenant(User.deleteMany({ role: "client" }));
    setCache(new MemoryStore());
  });

  after(async () => {
    setCache(null);
    if (safe) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  describe("counts", () => {
    it("returns every stage, zero-filled, for the caller's brokerage only", async () => {
      await mkLead(a, "new");
      await mkLead(a, "new");
      await mkLead(a, "won");
      await mkLead(b, "lost");

      const res = await dash(staff(a));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.counts, {
        new: 2,
        contacted: 0,
        qualified: 0,
        proposal: 0,
        won: 1,
        lost: 0,
      });
      assert.equal(res.body.total, 3);
    });

    it("is closed to clients and anonymous callers", async () => {
      const client = signToken({
        id: new Types.ObjectId().toString(),
        role: "client",
        brokerageId: a,
      });
      assert.equal((await dash(client)).status, 403);
      assert.equal((await request(app).get("/api/dashboard")).status, 401);
    });
  });

  describe("caching and invalidation", () => {
    it("serves the second request from the cache, even if the database changed underneath", async () => {
      await mkLead(a);
      const first = await dash(staff(a));
      assert.equal(first.headers["x-cache"], "MISS");

      await mkLead(a); // changed behind the cache's back: no invalidation
      const second = await dash(staff(a));
      assert.equal(second.headers["x-cache"], "HIT");
      assert.equal(second.body.total, 1);
    });

    it("a stage move invalidates", async () => {
      const lead = await mkLead(a, "new");
      await dash(staff(a));

      assert.equal(
        (await move(staff(a), lead.id, { stage: "contacted", version: 0 }))
          .status,
        200,
      );
      const after = await dash(staff(a));
      assert.equal(after.headers["x-cache"], "MISS");
      assert.equal(after.body.counts.new, 0);
      assert.equal(after.body.counts.contacted, 1);
      assert.equal((await dash(staff(a))).headers["x-cache"], "HIT");
    });

    it("a webhook-created lead invalidates", async () => {
      await dash(staff(a));
      const hook = await request(app)
        .post(`/api/leads/webhook/${a}`)
        .send({ name: "New", email: "new@example.de" });
      assert.equal(hook.status, 202);

      const after = await dash(staff(a));
      assert.equal(after.headers["x-cache"], "MISS");
      assert.equal(after.body.counts.new, 1);
    });

    it("a conversion invalidates", async () => {
      const lead = await mkLead(a, "new");
      await dash(staff(a));

      const res = await request(app)
        .post(`/api/leads/${lead.id}/convert`)
        .set(auth(staff(a)))
        .send({ version: 0, email: "client@portal.test" });
      assert.equal(res.status, 201);

      const after = await dash(staff(a));
      assert.equal(after.headers["x-cache"], "MISS");
      assert.equal(after.body.counts.won, 1);
    });

    it("one brokerage's change leaves another brokerage's cache alone", async () => {
      const leadA = await mkLead(a, "new");
      await mkLead(b, "lost");
      await dash(staff(a));
      await dash(staff(b));

      await move(staff(a), leadA.id, { stage: "won", version: 0 });

      const forA = await dash(staff(a));
      const forB = await dash(staff(b));
      assert.equal(forA.headers["x-cache"], "MISS");
      assert.equal(forB.headers["x-cache"], "HIT");
      assert.equal(forB.body.counts.lost, 1);
      assert.equal(forB.body.counts.won, 0); // never sees A's data
    });

    it("an invalidation landing between read and write cannot leave stale counts behind", async () => {
      const racy = new RacyStore();
      setCache(racy);
      racy.armed = true;

      const first = await dash(staff(a)); // reads epoch 0, then an invalidation lands, then it writes under epoch 0
      assert.equal(first.headers["x-cache"], "MISS");

      await mkLead(a, "new"); // the database now differs from what was just cached
      const second = await dash(staff(a));
      assert.equal(second.headers["x-cache"], "MISS"); // the old entry is unreachable
      assert.equal(second.body.total, 1);
    });
  });

  describe("fail open", () => {
    it("still answers, and lead changes still succeed, when Redis is down", async () => {
      setCache(new BrokenStore());
      const lead = await mkLead(a, "new");

      const res = await dash(staff(a));
      assert.equal(res.status, 200);
      assert.equal(res.headers["x-cache"], "MISS");
      assert.equal(res.body.total, 1);

      assert.equal(
        (await move(staff(a), lead.id, { stage: "contacted", version: 0 }))
          .status,
        200,
      );
    });

    it("works with no cache configured at all", async () => {
      setCache(null);
      await mkLead(a);
      const res = await dash(staff(a));
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 1);
    });
  });
});
