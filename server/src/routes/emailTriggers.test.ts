import "dotenv/config";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import request from "supertest";

import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { EmailTemplate } from "../models/EmailTemplate.js";
import { EmailTrigger } from "../models/EmailTrigger.js";
import { User } from "../models/User.js";
import { signToken } from "../lib/jwt.js";
import { skipTenant } from "../lib/tenantPlugin.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

describe("email triggers", () => {
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

    await EmailTrigger.syncIndexes();
    await EmailTemplate.syncIndexes();
    await User.syncIndexes();

    const [a, b] = await Brokerage.create([
      { name: "Trigger Brokerage A" },
      { name: "Trigger Brokerage B" },
    ]);

    brokerageA = a.id;
    brokerageB = b.id;
  });

  beforeEach(async () => {
    await skipTenant(EmailTrigger.deleteMany({}));
    await skipTenant(EmailTemplate.deleteMany({}));
    await skipTenant(User.deleteMany({}));
  });

  after(async () => {
    if (safe) {
      await mongoose.connection.dropDatabase();
    }

    await mongoose.disconnect();
  });

  it("allows brokerage admins to create and list triggers", async () => {
    const admin = token(brokerageA);

    const template = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Welcome",
        subject: "Welcome {{clientName}}",
        htmlBody: "<p>Hello {{clientName}}</p>",
      });

    assert.equal(template.status, 201);

    const templateId = template.body.template._id;

    const created = await request(app)
      .post("/api/email-triggers")
      .set(auth(admin))
      .send({
        stage: "new",
        templateId,
        enabled: true,
      });

    assert.equal(created.status, 201);
    assert.equal(created.body.trigger.stage, "new");
    assert.equal(created.body.trigger.enabled, true);
    assert.equal(created.body.trigger.templateId._id, templateId);

    const listed = await request(app)
      .get("/api/email-triggers")
      .set(auth(admin));

    assert.equal(listed.status, 200);
    assert.equal(listed.body.triggers.length, 1);
    assert.equal(listed.body.triggers[0].stage, "new");
  });

  it("blocks advisors from managing triggers", async () => {
    const advisor = token(brokerageA, "advisor");

    const response = await request(app)
      .get("/api/email-triggers")
      .set(auth(advisor));

    assert.equal(response.status, 403);
  });

  it("requires the template to belong to the same brokerage", async () => {
    const adminA = token(brokerageA);
    const adminB = token(brokerageB);

    const templateB = await request(app)
      .post("/api/email-templates")
      .set(auth(adminB))
      .send({
        name: "Private B",
        subject: "Private",
        htmlBody: "<p>Private</p>",
      });

    assert.equal(templateB.status, 201);

    const response = await request(app)
      .post("/api/email-triggers")
      .set(auth(adminA))
      .send({
        stage: "new",
        templateId: templateB.body.template._id,
      });

    assert.equal(response.status, 404);
  });

  it("allows only one trigger per stage", async () => {
    const admin = token(brokerageA);

    const firstTemplate = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "First",
        subject: "First",
        htmlBody: "<p>First</p>",
      });

    const secondTemplate = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Second",
        subject: "Second",
        htmlBody: "<p>Second</p>",
      });

    assert.equal(firstTemplate.status, 201);
    assert.equal(secondTemplate.status, 201);

    const first = await request(app)
      .post("/api/email-triggers")
      .set(auth(admin))
      .send({
        stage: "contacted",
        templateId: firstTemplate.body.template._id,
      });

    assert.equal(first.status, 201);

    const second = await request(app)
      .post("/api/email-triggers")
      .set(auth(admin))
      .send({
        stage: "contacted",
        templateId: secondTemplate.body.template._id,
      });

    assert.equal(second.status, 409);
  });

  it("allows an admin to update and disable a trigger", async () => {
    const admin = token(brokerageA);

    const firstTemplate = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "First",
        subject: "First",
        htmlBody: "<p>First</p>",
      });

    const secondTemplate = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Second",
        subject: "Second",
        htmlBody: "<p>Second</p>",
      });

    const created = await request(app)
      .post("/api/email-triggers")
      .set(auth(admin))
      .send({
        stage: "qualified",
        templateId: firstTemplate.body.template._id,
      });

    assert.equal(created.status, 201);

    const updated = await request(app)
      .patch(`/api/email-triggers/${created.body.trigger._id}`)
      .set(auth(admin))
      .send({
        templateId: secondTemplate.body.template._id,
        enabled: false,
      });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.trigger.enabled, false);
    assert.equal(
      updated.body.trigger.templateId._id,
      secondTemplate.body.template._id,
    );
  });

  it("keeps triggers isolated between brokerages", async () => {
    const adminA = token(brokerageA);
    const adminB = token(brokerageB);

    const templateA = await request(app)
      .post("/api/email-templates")
      .set(auth(adminA))
      .send({
        name: "A Template",
        subject: "A",
        htmlBody: "<p>A</p>",
      });

    assert.equal(templateA.status, 201);

    const created = await request(app)
      .post("/api/email-triggers")
      .set(auth(adminA))
      .send({
        stage: "proposal",
        templateId: templateA.body.template._id,
      });

    assert.equal(created.status, 201);

    const listedB = await request(app)
      .get("/api/email-triggers")
      .set(auth(adminB));

    assert.equal(listedB.status, 200);
    assert.equal(listedB.body.triggers.length, 0);

    const updateFromB = await request(app)
      .patch(`/api/email-triggers/${created.body.trigger._id}`)
      .set(auth(adminB))
      .send({
        enabled: false,
      });

    assert.equal(updateFromB.status, 404);

    const deleteFromB = await request(app)
      .delete(`/api/email-triggers/${created.body.trigger._id}`)
      .set(auth(adminB));

    assert.equal(deleteFromB.status, 404);
  });

  it("allows an admin to delete a trigger", async () => {
    const admin = token(brokerageA);

    const template = await request(app)
      .post("/api/email-templates")
      .set(auth(admin))
      .send({
        name: "Delete Me",
        subject: "Delete",
        htmlBody: "<p>Delete</p>",
      });

    assert.equal(template.status, 201);

    const created = await request(app)
      .post("/api/email-triggers")
      .set(auth(admin))
      .send({
        stage: "lost",
        templateId: template.body.template._id,
      });

    assert.equal(created.status, 201);

    const deleted = await request(app)
      .delete(`/api/email-triggers/${created.body.trigger._id}`)
      .set(auth(admin));

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);

    const listed = await request(app)
      .get("/api/email-triggers")
      .set(auth(admin));

    assert.equal(listed.status, 200);
    assert.equal(listed.body.triggers.length, 0);
  });
});
