import "dotenv/config";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { Brokerage } from "../models/Brokerage.js";
import { Lead } from "../models/Lead.js";
import type { Role } from "../models/User.js";
import { tenantStorage } from "../lib/tenantContext.js";
import { TenantError, skipTenant } from "../lib/tenantPlugin.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

const as = <T>(
  brokerageId: string | null,
  role: Role,
  fn: () => PromiseLike<T>,
) => tenantStorage.run({ brokerageId, role }, async () => await fn());

describe("lead webhook", () => {
  let safe = false;
  let a: string;
  let b: string;

  const hook = (brokerageId: string) => `/api/leads/webhook/${brokerageId}`;
  const send = (brokerageId: string, body: object, key?: string) => {
    const req = request(app).post(hook(brokerageId));
    if (key) req.set("Idempotency-Key", key);
    return req.send(body);
  };
  const leadsOf = async (brokerageId: string) =>
    await skipTenant(Lead.find({ brokerageId }));

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
    await Lead.syncIndexes(); // dropDatabase removed the unique indexes the dedup logic depends on

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

  describe("ingestion", () => {
    it('creates a normalized lead in the "new" stage', async () => {
      const res = await send(a, {
        name: "Max Muster",
        email: " Max@Example.DE ",
        phone: "0170 1234567",
        source: "website",
      });
      assert.equal(res.status, 202);
      const leads = await leadsOf(a);
      assert.equal(leads.length, 1);
      assert.equal(leads[0].email, "max@example.de");
      assert.equal(leads[0].phone, "+491701234567");
      assert.equal(leads[0].stage, "new");
    });

    it('answers "created" and "duplicate" identically', async () => {
      const first = await send(a, { name: "Max", email: "max@example.de" });
      const second = await send(a, { name: "Max", email: "max@example.de" });
      assert.equal(first.status, second.status);
      assert.deepEqual(first.body, second.body);
    });
  });

  describe("duplicate detection", () => {
    it("matches email regardless of case and whitespace", async () => {
      await send(a, { name: "One", email: "x@example.de" });
      await send(a, { name: "Two", email: " X@EXAMPLE.DE " });
      assert.equal((await leadsOf(a)).length, 1);
    });

    it("matches phone across notations, even with a different email", async () => {
      await send(a, {
        name: "One",
        email: "one@example.de",
        phone: "+49 170 1234567",
      });
      await send(a, {
        name: "Two",
        email: "two@example.de",
        phone: "0170 1234567",
      });
      assert.equal((await leadsOf(a)).length, 1);
    });

    it("is scoped to the tenant: the same email in another brokerage is a new lead", async () => {
      await send(a, { name: "One", email: "same@example.de" });
      await send(b, { name: "One", email: "same@example.de" });
      assert.equal((await leadsOf(a)).length, 1);
      assert.equal((await leadsOf(b)).length, 1);
    });
  });

  describe("idempotency and bursts", () => {
    it("a replayed key never creates a second lead, even if the payload differs", async () => {
      await send(a, { name: "One", email: "one@example.de" }, "key-1");
      await send(a, { name: "One again", email: "other@example.de" }, "key-1");
      assert.equal((await leadsOf(a)).length, 1);
    });

    it("the same key in different tenants does not collide", async () => {
      await send(a, { name: "One", email: "one@example.de" }, "key-1");
      await send(b, { name: "One", email: "one@example.de" }, "key-1");
      assert.equal((await leadsOf(a)).length, 1);
      assert.equal((await leadsOf(b)).length, 1);
    });

    it("10 simultaneous identical submissions create exactly one lead", async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          send(a, {
            name: "Burst",
            email: "burst@example.de",
            phone: "0170 1234567",
          }),
        ),
      );
      assert.ok(results.every((r) => r.status === 202));
      assert.equal((await leadsOf(a)).length, 1);
    });

    it("a burst with different keys but the same email still creates one lead", async () => {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          send(a, { name: "Burst", email: "keys@example.de" }, `key-${i}`),
        ),
      );
      assert.equal((await leadsOf(a)).length, 1);
    });
  });

  describe("rejection", () => {
    it("400 without a usable email or phone", async () => {
      assert.equal((await send(a, { name: "No contact" })).status, 400);
      assert.equal(
        (await send(a, { name: "Bad", email: "nope", phone: "12" })).status,
        400,
      );
    });

    it("404 for an unknown or malformed brokerage id", async () => {
      const unknown = new mongoose.Types.ObjectId().toString();
      assert.equal(
        (await send(unknown, { name: "X", email: "x@example.de" })).status,
        404,
      );
      assert.equal(
        (await send("not-an-id", { name: "X", email: "x@example.de" })).status,
        404,
      );
    });

    it("400 (not 500) for malformed JSON", async () => {
      const res = await request(app)
        .post(hook(a))
        .set("Content-Type", "application/json")
        .send("{bad");
      assert.equal(res.status, 400);
    });

    it("protects the webhook when a shared secret is configured", async () => {
      const previousSecret = env.WEBHOOK_SECRET;
      env.WEBHOOK_SECRET = "test-webhook-secret";

      try {
        const payload = {
          name: "Secret Test",
          email: "secret@example.de",
        };

        const missing = await request(app).post(hook(a)).send(payload);
        assert.equal(missing.status, 401);
        assert.equal(missing.body.error, "Invalid webhook secret");

        const wrong = await request(app)
          .post(hook(a))
          .set("X-Webhook-Secret", "wrong-secret")
          .send(payload);
        assert.equal(wrong.status, 401);
        assert.equal(wrong.body.error, "Invalid webhook secret");

        const correct = await request(app)
          .post(hook(a))
          .set("X-Webhook-Secret", "test-webhook-secret")
          .send(payload);
        assert.equal(correct.status, 202);

        assert.equal((await leadsOf(a)).length, 1);
      } finally {
        env.WEBHOOK_SECRET = previousSecret;
      }
    });
  });

  describe("Lead model is tenant-scoped", () => {
    it("cross-tenant ID guess returns nothing, and no context fails closed", async () => {
      await send(a, { name: "Private", email: "private@example.de" });
      const [lead] = await leadsOf(a);
      assert.ok(lead);

      assert.equal(await as(b, "advisor", () => Lead.findById(lead.id)), null);
      assert.equal(
        (await as(a, "advisor", () => Lead.findById(lead.id)))?.id,
        lead.id,
      );
      await assert.rejects(Lead.findById(lead.id).exec(), TenantError);
    });
  });
});
