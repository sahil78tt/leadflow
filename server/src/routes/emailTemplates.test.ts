import "dotenv/config";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import request from "supertest";

import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { EmailTemplate } from "../models/EmailTemplate.js";
import { User } from "../models/User.js";
import { signToken } from "../lib/jwt.js";
import { skipTenant } from "../lib/tenantPlugin.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

describe("email templates", () => {
  let safe = false;
  let brokerageA: string;
  let brokerageB: string;

  const token = (
    brokerageId: string,
    role: "brokerage_admin" | "advisor" = "brokerage_admin",
  ) =>
    signToken({
      id: new Types.ObjectId().toString(),
      role,
      brokerageId,
    });

  const auth = (jwt: string) => ({
    Authorization: `Bearer ${jwt}`,
  });

  before(async () => {
    if (!TEST_URI) {
      throw new Error(
        'Set MONGODB_URI_TEST in server/.env (database name must contain "test")',
      );
    }

    await mongoose.connect(TEST_URI);

    if (!mongoose.connection.name.includes("test")) {
      await mongoose.disconnect();
      throw new Error(
        `Refusing to run: database "${mongoose.connection.name}" does not look like a test DB`,
      );
    }

    safe = true;
    await mongoose.connection.dropDatabase();

    await EmailTemplate.syncIndexes();
    await User.syncIndexes();

    const [a, b] = await Brokerage.create([
      { name: "Template Brokerage A" },
      { name: "Template Brokerage B" },
    ]);

    brokerageA = a.id;
    brokerageB = b.id;
  });

  beforeEach(async () => {
    await skipTenant(EmailTemplate.deleteMany({}));
    await skipTenant(User.deleteMany({}));
  });

  after(async () => {
    if (safe) {
      await mongoose.connection.dropDatabase();
    }

    await mongoose.disconnect();
  });

  it("allows brokerage admins to create and list templates", async () => {
    const admin = token(brokerageA);

    const created = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Welcome",
        subject: "Welcome {{clientName}}",
        htmlBody: "<p>Hello {{clientName}}</p>",
      });

    assert.equal(created.status, 201);
    assert.equal(created.body.template.name, "Welcome");

    const listed = await request(app)
      .get("/api/email-templates")
      .set(auth(admin));

    assert.equal(listed.status, 200);
    assert.equal(listed.body.templates.length, 1);
    assert.equal(listed.body.templates[0].name, "Welcome");
  });

  it("blocks advisors from managing templates", async () => {
    const advisor = token(brokerageA, "advisor");

    const response = await request(app)
      .post("/api/email-templates")
      .set(auth(advisor))
      .send({
        name: "Blocked",
        subject: "Blocked",
        htmlBody: "<p>Blocked</p>",
      });

    assert.equal(response.status, 403);
  });

  it("keeps templates isolated between brokerages", async () => {
    const adminA = token(brokerageA);
    const adminB = token(brokerageB);

    const created = await request(app)
      .post("/api/email-templates")
      .set(auth(adminA))
      .send({
        name: "Private Template",
        subject: "Private",
        htmlBody: "<p>Private</p>",
      });

    assert.equal(created.status, 201);

    const listedB = await request(app)
      .get("/api/email-templates")
      .set(auth(adminB));

    assert.equal(listedB.status, 200);
    assert.equal(listedB.body.templates.length, 0);

    const templateId = created.body.template._id;

    const updateFromB = await request(app)
      .patch(`/api/email-templates/${templateId}`)
      .set(auth(adminB))
      .send({
        name: "Hijacked",
      });

    assert.equal(updateFromB.status, 404);

    const previewFromB = await request(app)
      .post(`/api/email-templates/${templateId}/preview`)
      .set(auth(adminB))
      .send({});

    assert.equal(previewFromB.status, 404);
  });

  it("updates, disables and deletes a template", async () => {
    const admin = token(brokerageA);

    const created = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Editable",
        subject: "Old subject",
        htmlBody: "<p>Old</p>",
      });

    assert.equal(created.status, 201);

    const templateId = created.body.template._id;

    const updated = await request(app)
      .patch(`/api/email-templates/${templateId}`)
      .set(auth(admin))
      .send({
        subject: "New subject",
        htmlBody: "<p>New</p>",
        enabled: false,
      });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.template.subject, "New subject");
    assert.equal(updated.body.template.enabled, false);

    const deleted = await request(app)
      .delete(`/api/email-templates/${templateId}`)
      .set(auth(admin));

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);

    const listed = await request(app)
      .get("/api/email-templates")
      .set(auth(admin));

    assert.equal(listed.status, 200);
    assert.equal(listed.body.templates.length, 0);
  });

  it("rejects duplicate template names", async () => {
    const admin = token(brokerageA);

    const first = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Duplicate",
        subject: "One",
        htmlBody: "<p>One</p>",
      });

    assert.equal(first.status, 201);

    const second = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Duplicate",
        subject: "Two",
        htmlBody: "<p>Two</p>",
      });

    assert.equal(second.status, 409);
  });

  it("renders supported placeholders in preview", async () => {
    const admin = token(brokerageA);

    const created = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Preview",
        subject: "Welcome {{clientName}} to {{brokerageName}}",
        htmlBody:
          "<p>Hello {{clientName}}</p><p>Your advisor is {{advisorName}}.</p><p>{{leadName}}</p>",
      });

    assert.equal(created.status, 201);

    const preview = await request(app)
      .post(`/api/email-templates/${created.body.template._id}/preview`)
      .set(auth(admin))
      .send({
        clientName: "Alex Client",
        advisorName: "Jordan Advisor",
        leadName: "Alex Lead",
        brokerageName: "Muster Brokerage",
      });

    assert.equal(preview.status, 200);
    assert.equal(
      preview.body.subject,
      "Welcome Alex Client to Muster Brokerage",
    );
    assert.match(preview.body.htmlBody, /Hello Alex Client/);
    assert.match(preview.body.htmlBody, /Jordan Advisor/);
    assert.match(preview.body.htmlBody, /Alex Lead/);
  });

  it("escapes preview values", async () => {
    const admin = token(brokerageA);

    const created = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Escaping",
        subject: "Hello {{clientName}}",
        htmlBody: "<p>{{clientName}}</p>",
      });

    assert.equal(created.status, 201);

    const preview = await request(app)
      .post(`/api/email-templates/${created.body.template._id}/preview`)
      .set(auth(admin))
      .send({
        clientName: '<script>alert("x")</script>',
      });

    assert.equal(preview.status, 200);
    assert.match(
      preview.body.htmlBody,
      /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/,
    );
    assert.doesNotMatch(preview.body.htmlBody, /<script>/);
  });
});
