import { Schema, model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenantPlugin.js";

export const TASK_STATUSES = ["pending", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface ITask {
  brokerageId: Types.ObjectId;
  leadId: Types.ObjectId;
  title: string;
  description?: string;
  assignedTo: Types.ObjectId;
  dueAt: Date;
  status: TaskStatus;
  completedAt?: Date;
  triggerId?: Types.ObjectId;
  triggerStage: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const taskSchema = new Schema<ITask>(
  {
    brokerageId: {
      type: Schema.Types.ObjectId,
      ref: "Brokerage",
      required: true,
      index: true,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: "Lead",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    dueAt: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: "pending",
      index: true,
    },
    completedAt: {
      type: Date,
    },
    triggerId: {
      type: Schema.Types.ObjectId,
      ref: "TaskTrigger",
    },
    triggerStage: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
);

// One task per lead + trigger + pipeline stage.
// This prevents duplicate tasks if the same stage event is processed twice.
taskSchema.index(
  { brokerageId: 1, leadId: 1, triggerId: 1, triggerStage: 1 },
  { unique: true, sparse: true },
);

taskSchema.index({ brokerageId: 1, status: 1, dueAt: 1 });

taskSchema.plugin(tenantPlugin);

export const Task = model<ITask>("Task", taskSchema);
