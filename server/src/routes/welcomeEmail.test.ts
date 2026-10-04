import "dotenv/config";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { Lead } from "../models/Lead.js";
import { signToken } from "../lib/jwt.js";
import { mailer, type EmailMessage } from "../lib/mailer.js";
import { skipTenant } from "../lib/tenantPlugin.js";
import { emailConfig, sendWelcomeEmail } from "../lib/welcomeEmail.js";

const TEST_URI = process.env.MONGODB_URI_TEST;
const realConfigured = mailer.configured; // captured before any test stubs it

describe("welcome email", () => {
  let safe = false;
  let a: string;
  let b: string;
  const sent: EmailMessage[] = [];

  const staff = (brokerageId: string) =>
    signToken({
      id: new Types.ObjectId().toString(),
      role: "advisor",
      brokerageId,
    });
  const hook = (brokerageId: string, body: object) =>
    request(app).post(`/api/leads/webhook/${brokerageId}`).send(body);
  const move = (brokerageId: string, id: string, body: object) =>
    request(app)
      .patch(`/api/leads/${id}/stage`)
      .set({ Authorization: `Bearer ${staff(brokerageId)}` })
      .send(body);
  const welcome = async (email: string) =>
    (await skipTenant(Lead.findOne({ email }).select("+welcomeEmail")))
      ?.welcomeEmail;
  const mkLead = async (
    brokerageId: string,
    email: string,
    stage: "new" | "contacted" = "new",
  ) =>
    await Lead.create({
      brokerageId: new Types.ObjectId(brokerageId),
      name: "Max Muster",
      email,
      stage,
    });

  const waitFor = async (
    check: () => boolean | Promise<boolean>,
    ms = 2000,
  ) => {
    const deadline = Date.now() + ms;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error("condition not met in time");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

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
      { name: "Muster Finanz GmbH" },
      { name: "Hausbau Partner AG" },
    ]);
    a = brokerageA.id;
    b = brokerageB.id;
  });

  beforeEach(async () => {
    sent.length = 0;
    emailConfig.dailyCapPerBrokerage = 25;
    mailer.configured = () => true;
    mailer.send = async (message) => {
      sent.push(message);
      return { id: `email-${sent.length}` };
    };
    await skipTenant(Lead.deleteMany({}));
  });

  after(async () => {
    if (safe) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it("the real mailer is switched off under the test runner", () => {
    assert.equal(realConfigured(), false); // proves the preload in package.json is active
  });

  describe("trigger", () => {
    it("a new webhook lead gets one welcome email from its own brokerage", async () => {
      assert.equal(
        (await hook(a, { name: "Max Muster", email: "max@leads.test" })).status,
        202,
      );
      await waitFor(() => sent.length === 1);
      assert.equal(sent[0].to, "max@leads.test");
      assert.equal(sent[0].subject, "Welcome to Muster Finanz GmbH");
      assert.match(sent[0].html, /Max Muster/);

      await hook(b, { name: "Erika Beispiel", email: "erika@leads.test" });
      await waitFor(() => sent.length === 2);
      assert.equal(sent[1].subject, "Welcome to Hausbau Partner AG");

      await waitFor(
        async () => (await welcome("max@leads.test"))?.status === "sent",
      );
      assert.equal((await welcome("max@leads.test"))?.resendId, "email-1");
    });

    it("escapes the lead's name, which comes from an unauthenticated form", async () => {
      await hook(a, {
        name: "<script>alert(1)</script>",
        email: "xss@leads.test",
      });
      await waitFor(() => sent.length === 1);
      assert.match(sent[0].html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.doesNotMatch(sent[0].html, /<script>/);
    });

    it("a duplicate submission and a phone-only lead send nothing more", async () => {
      await hook(a, { name: "Max Muster", email: "max@leads.test" });
      await waitFor(() => sent.length === 1);
      await hook(a, { name: "Max Muster again", email: "max@leads.test" });
      assert.equal(
        (await hook(a, { name: "Phone Only", phone: "0170 1234567" })).status,
        202,
      );
      await settle();
      assert.equal(sent.length, 1);
    });

    it("a lead dragged into New gets the email if it never had one", async () => {
      const lead = await mkLead(a, "drag@leads.test", "contacted");
      assert.equal(
        (await move(a, lead.id, { stage: "new", version: 0 })).status,
        200,
      );
      await waitFor(() => sent.length === 1);
      assert.equal(sent[0].to, "drag@leads.test");
    });
  });

  describe("at most once", () => {
    it("moving a lead out of New and back in does not send a second email", async () => {
      await hook(a, { name: "Max Muster", email: "max@leads.test" });
      await waitFor(() => sent.length === 1);
      const lead = await skipTenant(Lead.findOne({ email: "max@leads.test" }));
      assert.ok(lead);

      await move(a, lead.id, { stage: "contacted", version: 0 });
      await move(a, lead.id, { stage: "new", version: 1 });
      await settle();
      assert.equal(sent.length, 1);
    });

    it("two simultaneous triggers for one lead send exactly one email", async () => {
      const lead = await mkLead(a, "race@leads.test");
      const target = {
        id: lead.id,
        brokerageId: a,
        name: lead.name,
        email: "race@leads.test",
      };

      const outcomes = await Promise.all([
        sendWelcomeEmail(target),
        sendWelcomeEmail(target),
      ]);
      assert.deepEqual([...outcomes].sort(), ["already_handled", "sent"]);
      assert.equal(sent.length, 1);
    });
  });

  describe("failure and limits", () => {
    it("a provider failure is recorded, never breaks the request, and a later entry to New retries", async () => {
      mailer.send = async () => {
        throw new Error(
          "Resend 403: you can only send testing emails to your own address",
        );
      };
      assert.equal(
        (await hook(a, { name: "Max Muster", email: "max@leads.test" })).status,
        202,
      );
      await waitFor(
        async () => (await welcome("max@leads.test"))?.status === "failed",
      );
      assert.match(
        (await welcome("max@leads.test"))?.error ?? "",
        /Resend 403/,
      );
      assert.equal(sent.length, 0);

      mailer.send = async (message) => {
        sent.push(message);
        return { id: "email-retry" };
      };
      const lead = await skipTenant(Lead.findOne({ email: "max@leads.test" }));
      assert.ok(lead);
      await move(a, lead.id, { stage: "contacted", version: 0 });
      await move(a, lead.id, { stage: "new", version: 1 });
      await waitFor(() => sent.length === 1);
      await waitFor(
        async () => (await welcome("max@leads.test"))?.status === "sent",
      );
    });

    it("does nothing when email is not configured", async () => {
      mailer.configured = () => false;
      assert.equal(
        (await hook(a, { name: "Max Muster", email: "max@leads.test" })).status,
        202,
      );
      await settle();
      assert.equal(sent.length, 0);
      assert.equal(await welcome("max@leads.test"), undefined);
    });

    it("stops at the daily cap, per brokerage", async () => {
      emailConfig.dailyCapPerBrokerage = 2;
      for (const n of [1, 2]) {
        await hook(a, { name: `Lead ${n}`, email: `lead${n}@leads.test` });
        await waitFor(() => sent.length === n);
      }

      await hook(a, { name: "Lead 3", email: "lead3@leads.test" });
      await settle();
      assert.equal(sent.length, 2); // the third is held back
      assert.equal(await welcome("lead3@leads.test"), undefined); // and stays eligible for later

      await hook(b, { name: "Other brokerage", email: "other@leads.test" });
      await waitFor(() => sent.length === 3); // another brokerage has its own cap
    });
  });
});
