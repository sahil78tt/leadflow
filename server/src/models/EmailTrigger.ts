import { Schema, model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenantPlugin.js";
import { STAGES, type Stage } from "./Lead.js";

export interface IEmailTrigger {
  brokerageId: Types.ObjectId;
  stage: Stage;
  templateId: Types.ObjectId;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const emailTriggerSchema = new Schema<IEmailTrigger>(
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
    templateId: {
      type: Schema.Types.ObjectId,
      ref: "EmailTemplate",
      required: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

emailTriggerSchema.index(
  { brokerageId: 1, stage: 1 },
  { unique: true },
);

emailTriggerSchema.plugin(tenantPlugin);

export const EmailTrigger = model<IEmailTrigger>(
  "EmailTrigger",
  emailTriggerSchema,
);
