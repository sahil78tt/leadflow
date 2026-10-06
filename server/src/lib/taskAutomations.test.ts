import "dotenv/config";

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";

import { Brokerage } from "../models/Brokerage.js";
import { Lead } from "../models/Lead.js";
import { Task } from "../models/Task.js";
import { TaskTrigger } from "../models/TaskTrigger.js";
import { User } from "../models/User.js";
import { skipTenant } from "./tenantPlugin.js";
import { tenantStorage } from "./tenantContext.js";
import { processStageTask } from "./taskAutomations.js";

const TEST_URI = process.env.MONGODB_URI_TEST;

if (!TEST_URI) {
  throw new Error("MONGODB_URI_TEST is required");
}

let brokerageA: any;
let brokerageB: any;
let advisorA: any;
let advisorB: any;
let leadA: any;

async function runAsTenant<T>(brokerageId: string, fn: () => Promise<T>) {
  return tenantStorage.run(
    {
      brokerageId,
      role: "system",
    },
    fn,
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
  await Lead.syncIndexes();
  await TaskTrigger.syncIndexes();
  await Task.syncIndexes();
});

beforeEach(async () => {
  await skipTenant(Task.deleteMany({}));
  await skipTenant(TaskTrigger.deleteMany({}));
  await skipTenant(Lead.deleteMany({}));
  await skipTenant(User.deleteMany({}));

  brokerageA = await Brokerage.create({
    name: "Brokerage A",
  });

  brokerageB = await Brokerage.create({
    name: "Brokerage B",
  });

  advisorA = await User.create({
    brokerageId: brokerageA._id,
    name: "Advisor A",
    email: `automation-advisor-a-${Date.now()}@example.com`,
    passwordHash: "test-password-hash",
    role: "advisor",
  });

  advisorB = await User.create({
    brokerageId: brokerageB._id,
    name: "Advisor B",
    email: `automation-advisor-b-${Date.now()}@example.com`,
    passwordHash: "test-password-hash",
    role: "advisor",
  });

  leadA = await Lead.create({
    brokerageId: brokerageA._id,
    name: "Lead A",
    email: `automation-lead-${Date.now()}@example.com`,
    phone: "9999999999",
    source: "test",
    stage: "new",
  });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("Task stage automation", () => {
  it("creates a task from an enabled stage trigger", async () => {
    await runAsTenant(brokerageA._id.toString(), async () => {
      await TaskTrigger.create({
        brokerageId: brokerageA._id,
        stage: "new",
        title: "Call new lead",
        description: "Call the new lead within one hour.",
        assignedTo: advisorA._id,
        dueInMinutes: 60,
        enabled: true,
      });

      const before = Date.now();

      const outcome = await processStageTask({
        leadId: leadA._id.toString(),
        brokerageId: brokerageA._id.toString(),
        stage: "new",
      });

      const after = Date.now();

      assert.equal(outcome, "created");

      const task = await Task.findOne({
        brokerageId: brokerageA._id,
        leadId: leadA._id,
      });

      assert.ok(task);
      assert.equal(task.title, "Call new lead");
      assert.equal(task.description, "Call the new lead within one hour.");
      assert.equal(task.assignedTo.toString(), advisorA._id.toString());
      assert.equal(task.status, "pending");
      assert.equal(task.triggerStage, "new");

      const due = task.dueAt.getTime();

      assert.ok(
        due >= before + 60 * 60 * 1000 - 2000,
        "dueAt should be approximately one hour in the future",
      );

      assert.ok(
        due <= after + 60 * 60 * 1000 + 2000,
        "dueAt should be approximately one hour in the future",
      );
    });
  });

  it("does not create duplicate tasks when processed twice", async () => {
    await runAsTenant(brokerageA._id.toString(), async () => {
      await TaskTrigger.create({
        brokerageId: brokerageA._id,
        stage: "qualified",
        title: "Follow up qualified lead",
        assignedTo: advisorA._id,
        dueInMinutes: 120,
        enabled: true,
      });

      const first = await processStageTask({
        leadId: leadA._id.toString(),
        brokerageId: brokerageA._id.toString(),
        stage: "qualified",
      });

      const second = await processStageTask({
        leadId: leadA._id.toString(),
        brokerageId: brokerageA._id.toString(),
        stage: "qualified",
      });

      assert.equal(first, "created");
      assert.equal(second, "already_handled");

      const count = await Task.countDocuments({
        brokerageId: brokerageA._id,
        leadId: leadA._id,
        triggerStage: "qualified",
      });

      assert.equal(count, 1);
    });
  });

  it("skips disabled triggers", async () => {
    await runAsTenant(brokerageA._id.toString(), async () => {
      await TaskTrigger.create({
        brokerageId: brokerageA._id,
        stage: "contacted",
        title: "Disabled task",
        assignedTo: advisorA._id,
        dueInMinutes: 60,
        enabled: false,
      });

      const outcome = await processStageTask({
        leadId: leadA._id.toString(),
        brokerageId: brokerageA._id.toString(),
        stage: "contacted",
      });

      assert.equal(outcome, "skipped");

      const count = await Task.countDocuments({
        brokerageId: brokerageA._id,
        leadId: leadA._id,
      });

      assert.equal(count, 0);
    });
  });

  it("skips a trigger with no valid assigned advisor", async () => {
    await runAsTenant(brokerageA._id.toString(), async () => {
      await TaskTrigger.create({
        brokerageId: brokerageA._id,
        stage: "proposal",
        title: "Invalid advisor task",
        assignedTo: new Types.ObjectId(),
        dueInMinutes: 60,
        enabled: true,
      });

      const outcome = await processStageTask({
        leadId: leadA._id.toString(),
        brokerageId: brokerageA._id.toString(),
        stage: "proposal",
      });

      assert.equal(outcome, "skipped");

      const count = await Task.countDocuments({
        brokerageId: brokerageA._id,
        leadId: leadA._id,
      });

      assert.equal(count, 0);
    });
  });

  it("does not use another brokerage's trigger", async () => {
    await tenantStorage.run(
      {
        brokerageId: brokerageB._id.toString(),
        role: "system",
      },
      async () => {
        await TaskTrigger.create({
          brokerageId: brokerageB._id,
          stage: "new",
          title: "Brokerage B private task",
          assignedTo: advisorB._id,
          dueInMinutes: 60,
          enabled: true,
        });
      },
    );

    const outcome = await processStageTask({
      leadId: leadA._id.toString(),
      brokerageId: brokerageA._id.toString(),
      stage: "new",
    });

    assert.equal(outcome, "skipped");

    await runAsTenant(brokerageA._id.toString(), async () => {
      const count = await Task.countDocuments({
        brokerageId: brokerageA._id,
        leadId: leadA._id,
      });

      assert.equal(count, 0);
    });
  });
});
