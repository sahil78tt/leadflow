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
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { signToken } from "../lib/jwt.js";
import { skipTenant } from "../lib/tenantPlugin.js";
import { tenantStorage } from "../lib/tenantContext.js";

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

async function createTask(options: {
  brokerageId: Types.ObjectId;
  leadId?: Types.ObjectId;
  assignedTo: Types.ObjectId;
  title?: string;
  dueAt?: Date;
  status?: "pending" | "completed";
}) {
  return tenantStorage.run(
    {
      brokerageId: options.brokerageId.toString(),
      role: "system",
    },
    async () => {
      return Task.create({
        brokerageId: options.brokerageId,
        leadId: options.leadId ?? new Types.ObjectId(),
        title: options.title ?? "Follow up with lead",
        description: "Test task description",
        assignedTo: options.assignedTo,
        dueAt:
          options.dueAt ??
          new Date(Date.now() + 60 * 60 * 1000),
        status: options.status ?? "pending",
        triggerStage: "new",
      });
    },
  );
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
  await Task.syncIndexes();
});

beforeEach(async () => {
  await skipTenant(Task.deleteMany({}));
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
    email: `tasks-admin-a-${Date.now()}@example.com`,
    passwordHash: "test-password-hash",
    role: "brokerage_admin",
  });

  advisorA = await User.create({
    brokerageId: brokerageA._id,
    name: "Advisor A",
    email: `tasks-advisor-a-${Date.now()}@example.com`,
    passwordHash: "test-password-hash",
    role: "advisor",
  });

  advisorB = await User.create({
    brokerageId: brokerageB._id,
    name: "Advisor B",
    email: `tasks-advisor-b-${Date.now()}@example.com`,
    passwordHash: "test-password-hash",
    role: "advisor",
  });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("Task routes", () => {
  it("advisor sees only tasks assigned to them", async () => {
    await createTask({
      brokerageId: brokerageA._id,
      assignedTo: advisorA._id,
      title: "Advisor A task",
    });

    await createTask({
      brokerageId: brokerageA._id,
      assignedTo: adminA._id,
      title: "Admin task",
    });

    const res = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${token(advisorA)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.tasks.length, 1);
    assert.equal(res.body.tasks[0].title, "Advisor A task");
    assert.equal(
      res.body.tasks[0].assignedTo.id,
      advisorA._id.toString(),
    );
  });

  it("brokerage admin can see all tasks in their brokerage", async () => {
    await createTask({
      brokerageId: brokerageA._id,
      assignedTo: advisorA._id,
      title: "Advisor task",
    });

    await createTask({
      brokerageId: brokerageA._id,
      assignedTo: adminA._id,
      title: "Admin task",
    });

    const res = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${token(adminA)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.tasks.length, 2);

    const titles = res.body.tasks.map((task: any) => task.title);

    assert.ok(titles.includes("Advisor task"));
    assert.ok(titles.includes("Admin task"));
  });

  it("advisor cannot access another advisor's task", async () => {
    const task = await createTask({
      brokerageId: brokerageA._id,
      assignedTo: adminA._id,
      title: "Admin owned task",
    });

    const complete = await request(app)
      .patch(`/api/tasks/${task._id}/complete`)
      .set("Authorization", `Bearer ${token(advisorA)}`);

    assert.equal(complete.status, 404);
  });

  it("marks pending overdue tasks correctly", async () => {
    await createTask({
      brokerageId: brokerageA._id,
      assignedTo: advisorA._id,
      title: "Overdue task",
      dueAt: new Date(Date.now() - 60 * 60 * 1000),
      status: "pending",
    });

    const res = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${token(advisorA)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.tasks.length, 1);
    assert.equal(res.body.tasks[0].overdue, true);
    assert.equal(res.body.tasks[0].status, "pending");
  });

  it("completed overdue tasks are not marked overdue", async () => {
    await createTask({
      brokerageId: brokerageA._id,
      assignedTo: advisorA._id,
      title: "Completed old task",
      dueAt: new Date(Date.now() - 60 * 60 * 1000),
      status: "completed",
    });

    const res = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${token(advisorA)}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.tasks.length, 1);
    assert.equal(res.body.tasks[0].overdue, false);
    assert.equal(res.body.tasks[0].status, "completed");
  });

  it("advisor can complete and reopen their own task", async () => {
    const task = await createTask({
      brokerageId: brokerageA._id,
      assignedTo: advisorA._id,
      title: "Complete me",
    });

    const complete = await request(app)
      .patch(`/api/tasks/${task._id}/complete`)
      .set("Authorization", `Bearer ${token(advisorA)}`);

    assert.equal(complete.status, 200);
    assert.equal(complete.body.task.status, "completed");
    assert.ok(complete.body.task.completedAt);

    const reopen = await request(app)
      .patch(`/api/tasks/${task._id}/reopen`)
      .set("Authorization", `Bearer ${token(advisorA)}`);

    assert.equal(reopen.status, 200);
    assert.equal(reopen.body.task.status, "pending");
    assert.equal(reopen.body.task.completedAt, null);
  });

  it("tasks are isolated between brokerages", async () => {
    await createTask({
      brokerageId: brokerageB._id,
      assignedTo: advisorB._id,
      title: "Brokerage B private task",
    });

    const adminAList = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${token(adminA)}`);

    assert.equal(adminAList.status, 200);
    assert.equal(adminAList.body.tasks.length, 0);

    const advisorAList = await request(app)
      .get("/api/tasks")
      .set("Authorization", `Bearer ${token(advisorA)}`);

    assert.equal(advisorAList.status, 200);
    assert.equal(advisorAList.body.tasks.length, 0);
  });

  it("supports pending and completed status filters", async () => {
    await createTask({
      brokerageId: brokerageA._id,
      assignedTo: advisorA._id,
      title: "Pending task",
      status: "pending",
    });

    await createTask({
      brokerageId: brokerageA._id,
      assignedTo: advisorA._id,
      title: "Completed task",
      status: "completed",
    });

    const pending = await request(app)
      .get("/api/tasks?status=pending")
      .set("Authorization", `Bearer ${token(advisorA)}`);

    assert.equal(pending.status, 200);
    assert.equal(pending.body.tasks.length, 1);
    assert.equal(pending.body.tasks[0].title, "Pending task");

    const completed = await request(app)
      .get("/api/tasks?status=completed")
      .set("Authorization", `Bearer ${token(advisorA)}`);

    assert.equal(completed.status, 200);
    assert.equal(completed.body.tasks.length, 1);
    assert.equal(completed.body.tasks[0].title, "Completed task");
  });
});
