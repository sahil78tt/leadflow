import {
  after,
  before,
  beforeEach,
  describe,
  it,
} from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import request from "supertest";

import { app } from "../app.js";
import { Brokerage } from "../models/Brokerage.js";
import { TaskTrigger } from "../models/TaskTrigger.js";
import { User } from "../models/User.js";
import { signToken } from "../lib/jwt.js";
import { skipTenant } from "../lib/tenantPlugin.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

if (!TEST_URI) {
  throw new Error("MONGODB_URI_TEST is required");
}

let brokerageA: any;
let brokerageB: any;
let adminA: any;
let advisorA: any;
let advisorB: any;

function token(user: any) {
  return signToken({
    id: user._id.toString(),
    role: user.role,
    brokerageId: user.brokerageId?.toString(),
  });
}

before(async () => {
  await mongoose.connect(TEST_URI);

  const dbName = mongoose.connection.db?.databaseName ?? "";

  assert.match(
    dbName,
    /test/i,
    `Refusing to run tests against non-test database: ${dbName}`,
  );

  await mongoose.connection.dropDatabase();

  await Brokerage.syncIndexes();
  await User.syncIndexes();
  await TaskTrigger.syncIndexes();
});

beforeEach(async () => {
  await skipTenant(TaskTrigger.deleteMany({}));
  await skipTenant(User.deleteMany({}));

  brokerageA = await Brokerage.create({
    name: "Brokerage A",
  });

  brokerageB = await Brokerage.create({
    name: "Brokerage B",
  });

  adminA = await User.create({
    brokerageId: brokerageA._id,
    name: "Admin A",
    email: `task-admin-a-${Date.now()}@example.com`,
    passwordHash: "test-password-hash",
    role: "brokerage_admin",
  });

  advisorA = await User.create({
    brokerageId: brokerageA._id,
    name: "Advisor A",
    email: `task-advisor-a-${Date.now()}@example.com`,
    passwordHash: "test-password-hash",
    role: "advisor",
  });

  advisorB = await User.create({
    brokerageId: brokerageB._id,
    name: "Advisor B",
    email: `task-advisor-b-${Date.now()}@example.com`,
    passwordHash: "test-password-hash",
    role: "advisor",
  });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("TaskTrigger routes", () => {
  it("brokerage admin can create and list task triggers", async () => {
    const res = await request(app)
      .post("/api/task-triggers")
      .set("Authorization", `Bearer ${token(adminA)}`)
      .send({
        stage: "qualified",
        title: "Call qualified lead",
        description: "Call the lead and confirm requirements.",
        assignedTo: advisorA._id.toString(),
        dueInMinutes: 120,
        enabled: true,
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.trigger.stage, "qualified");
    assert.equal(res.body.trigger.title, "Call qualified lead");
    assert.equal(
      res.body.trigger.assignedTo._id.toString(),
      advisorA._id.toString(),
    );

    const list = await request(app)
      .get("/api/task-triggers")
      .set("Authorization", `Bearer ${token(adminA)}`);

    assert.equal(list.status, 200);
    assert.equal(list.body.triggers.length, 1);
    assert.equal(list.body.triggers[0].stage, "qualified");
  });

  it("advisor cannot manage task triggers", async () => {
    const res = await request(app)
      .post("/api/task-triggers")
      .set("Authorization", `Bearer ${token(advisorA)}`)
      .send({
        stage: "new",
        title: "Call new lead",
        assignedTo: advisorA._id.toString(),
        dueInMinutes: 60,
      });

    assert.equal(res.status, 403);
  });

  it("rejects an advisor from another brokerage", async () => {
    const res = await request(app)
      .post("/api/task-triggers")
      .set("Authorization", `Bearer ${token(adminA)}`)
      .send({
        stage: "new",
        title: "Cross tenant task",
        assignedTo: advisorB._id.toString(),
        dueInMinutes: 60,
      });

    assert.equal(res.status, 404);
    assert.equal(
      res.body.error,
      "Advisor not found in this brokerage",
    );
  });

  it("allows only one trigger per pipeline stage", async () => {
    const first = await request(app)
      .post("/api/task-triggers")
      .set("Authorization", `Bearer ${token(adminA)}`)
      .send({
        stage: "contacted",
        title: "First contacted task",
        assignedTo: advisorA._id.toString(),
        dueInMinutes: 60,
      });

    assert.equal(first.status, 201);

    const second = await request(app)
      .post("/api/task-triggers")
      .set("Authorization", `Bearer ${token(adminA)}`)
      .send({
        stage: "contacted",
        title: "Second contacted task",
        assignedTo: advisorA._id.toString(),
        dueInMinutes: 120,
      });

    assert.equal(second.status, 409);
  });

  it("admin can update and disable a trigger", async () => {
    const created = await request(app)
      .post("/api/task-triggers")
      .set("Authorization", `Bearer ${token(adminA)}`)
      .send({
        stage: "proposal",
        title: "Review proposal",
        assignedTo: advisorA._id.toString(),
        dueInMinutes: 180,
      });

    assert.equal(created.status, 201);

    const id = created.body.trigger._id;

    const updated = await request(app)
      .patch(`/api/task-triggers/${id}`)
      .set("Authorization", `Bearer ${token(adminA)}`)
      .send({
        title: "Review proposal with client",
        dueInMinutes: 240,
        enabled: false,
      });

    assert.equal(updated.status, 200);
    assert.equal(
      updated.body.trigger.title,
      "Review proposal with client",
    );
    assert.equal(updated.body.trigger.dueInMinutes, 240);
    assert.equal(updated.body.trigger.enabled, false);
  });

  it("does not expose another brokerage's trigger", async () => {
    const trigger = await TaskTrigger.create({
      brokerageId: brokerageB._id,
      stage: "won",
      title: "Brokerage B task",
      assignedTo: advisorB._id,
      dueInMinutes: 60,
      enabled: true,
    });

    const get = await request(app)
      .get("/api/task-triggers")
      .set("Authorization", `Bearer ${token(adminA)}`);

    assert.equal(get.status, 200);
    assert.equal(get.body.triggers.length, 0);

    const patch = await request(app)
      .patch(`/api/task-triggers/${trigger._id}`)
      .set("Authorization", `Bearer ${token(adminA)}`)
      .send({
        title: "Attempted cross tenant update",
      });

    assert.equal(patch.status, 404);

    const del = await request(app)
      .delete(`/api/task-triggers/${trigger._id}`)
      .set("Authorization", `Bearer ${token(adminA)}`);

    assert.equal(del.status, 404);
  });

  it("admin can delete a trigger", async () => {
    const created = await request(app)
      .post("/api/task-triggers")
      .set("Authorization", `Bearer ${token(adminA)}`)
      .send({
        stage: "lost",
        title: "Record lost reason",
        assignedTo: advisorA._id.toString(),
        dueInMinutes: 30,
      });

    assert.equal(created.status, 201);

    const deleted = await request(app)
      .delete(`/api/task-triggers/${created.body.trigger._id}`)
      .set("Authorization", `Bearer ${token(adminA)}`);

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.ok, true);

    const list = await request(app)
      .get("/api/task-triggers")
      .set("Authorization", `Bearer ${token(adminA)}`);

    assert.equal(list.status, 200);
    assert.equal(list.body.triggers.length, 0);
  });
});
