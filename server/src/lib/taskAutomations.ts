import { Types } from "mongoose";
import { Lead, STAGES, type Stage } from "../models/Lead.js";
import { TaskTrigger, type ITaskTrigger } from "../models/TaskTrigger.js";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";
import { tenantStorage } from "./tenantContext.js";

export type StageTaskOutcome =
  | "created"
  | "already_handled"
  | "skipped"
  | "failed";

export interface StageTaskTarget {
  leadId: string;
  brokerageId: string;
  stage: Stage;
}

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

async function createConfiguredTask(
  target: StageTaskTarget,
): Promise<StageTaskOutcome> {
  const brokerageId = new Types.ObjectId(target.brokerageId);
  const leadId = new Types.ObjectId(target.leadId);

  const trigger = (await TaskTrigger.findOne({
    brokerageId,
    stage: target.stage,
    enabled: true,
  }).lean()) as (ITaskTrigger & { _id: Types.ObjectId }) | null;

  // ================= DEBUG LOG START =================
  console.log("TASK AUTOMATION DEBUG", {
    brokerageId: target.brokerageId,
    leadId: target.leadId,
    stage: target.stage,
    triggerFound: Boolean(trigger),
    triggerId: trigger?._id?.toString(),
    triggerEnabled: trigger?.enabled,
    assignedTo: trigger?.assignedTo?.toString(),
    dueInMinutes: trigger?.dueInMinutes,
    title: trigger?.title,
  });
  // ================= DEBUG LOG END =================

  if (!trigger) {
    console.warn("TASK AUTOMATION: no enabled trigger found", {
      brokerageId: target.brokerageId,
      stage: target.stage,
    });

    return "skipped";
  }

  if (!trigger.assignedTo) {
    console.error(
      "Task trigger has no assigned advisor",
      trigger._id.toString(),
      target.stage,
    );

    return "skipped";
  }

  const advisor = await User.findOne({
    _id: trigger.assignedTo,
    brokerageId,
    role: "advisor",
  });

  if (!advisor) {
    console.error(
      "Task trigger assigned advisor is invalid",
      trigger._id.toString(),
      trigger.assignedTo.toString(),
    );

    return "skipped";
  }

  const lead = await Lead.findOne({
    _id: leadId,
    brokerageId,
  });

  if (!lead) {
    console.warn("TASK AUTOMATION: lead not found", {
      leadId: target.leadId,
      brokerageId: target.brokerageId,
    });

    return "skipped";
  }

  const dueAt = new Date(Date.now() + trigger.dueInMinutes * 60 * 1000);

  try {
    const created = await Task.create({
      brokerageId,
      leadId,
      title: trigger.title,
      description: trigger.description,
      assignedTo: advisor._id,
      dueAt,
      status: "pending",
      triggerId: trigger._id,
      triggerStage: target.stage,
    });

    // ================= DEBUG LOG START =================
    console.log("TASK AUTOMATION: task created", {
      taskId: created._id.toString(),
      leadId: target.leadId,
      advisorId: advisor._id.toString(),
      dueAt: dueAt.toISOString(),
    });
    // ================= DEBUG LOG END =================

    return "created";
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // ================= DEBUG LOG START =================
      console.log("TASK AUTOMATION: duplicate, already handled", {
        leadId: target.leadId,
        triggerId: trigger._id.toString(),
      });
      // ================= DEBUG LOG END =================

      return "already_handled";
    }

    throw error;
  }
}

export async function processStageTask(
  target: StageTaskTarget,
): Promise<StageTaskOutcome> {
  // ================= DEBUG LOG START =================
  console.log("TASK AUTOMATION: processStageTask called", {
    leadId: target.leadId,
    brokerageId: target.brokerageId,
    stage: target.stage,
    stageValid: STAGES.includes(target.stage),
    brokerageIdValid: Types.ObjectId.isValid(target.brokerageId),
    leadIdValid: Types.ObjectId.isValid(target.leadId),
  });
  // ================= DEBUG LOG END =================

  if (!STAGES.includes(target.stage)) {
    return "skipped";
  }

  if (
    !Types.ObjectId.isValid(target.brokerageId) ||
    !Types.ObjectId.isValid(target.leadId)
  ) {
    return "skipped";
  }

  try {
    return await tenantStorage.run(
      {
        brokerageId: target.brokerageId,
        role: "system",
      },
      async () => createConfiguredTask(target),
    );
  } catch (error) {
    console.error(
      "stage task automation crashed",
      target.leadId,
      target.stage,
      error,
    );

    return "failed";
  }
}
