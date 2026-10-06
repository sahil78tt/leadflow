import { Schema, model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenantPlugin.js";

export const EMAIL_DELIVERY_STATUSES = [
  "sending",
  "sent",
  "failed",
] as const;

export type EmailDeliveryStatus =
  (typeof EMAIL_DELIVERY_STATUSES)[number];

export interface IEmailDelivery {
  brokerageId: Types.ObjectId;
  leadId: Types.ObjectId;
  triggerId: Types.ObjectId;
  stage: string;
  status: EmailDeliveryStatus;
  at: Date;
  resendId?: string;
  error?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const emailDeliverySchema = new Schema<IEmailDelivery>(
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
    triggerId: {
      type: Schema.Types.ObjectId,
      ref: "EmailTrigger",
      required: true,
      index: true,
    },
    stage: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: EMAIL_DELIVERY_STATUSES,
      required: true,
      index: true,
    },
    at: {
      type: Date,
      required: true,
    },
    resendId: String,
    error: String,
  },
  { timestamps: true },
);

emailDeliverySchema.index(
  { brokerageId: 1, leadId: 1, triggerId: 1 },
  { unique: true },
);

emailDeliverySchema.index({
  brokerageId: 1,
  status: 1,
  at: 1,
});

emailDeliverySchema.plugin(tenantPlugin);

export const EmailDelivery = model<IEmailDelivery>(
  "EmailDelivery",
  emailDeliverySchema,
);
