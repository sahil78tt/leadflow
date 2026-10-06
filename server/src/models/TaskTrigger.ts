import { Schema, model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenantPlugin.js";
import { STAGES, type Stage } from "./Lead.js";

export interface ITaskTrigger {
  brokerageId: Types.ObjectId;
  stage: Stage;
  title: string;
  description?: string;
  assignedTo?: Types.ObjectId;
  dueInMinutes: number;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const taskTriggerSchema = new Schema<ITaskTrigger>(
  {
    brokerageId: {
      type: Schema.Types.ObjectId,
      ref: "Brokerage",
      required: true,
      index: true,
    },
    stage: {
      type: String,
      enum: STAGES,
      required: true,
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
    },
    dueInMinutes: {
      type: Number,
      required: true,
      min: 1,
      max: 525600,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

taskTriggerSchema.index(
  { brokerageId: 1, stage: 1 },
  { unique: true },
);

taskTriggerSchema.plugin(tenantPlugin);

export const TaskTrigger = model<ITaskTrigger>(
  "TaskTrigger",
  taskTriggerSchema,
);
