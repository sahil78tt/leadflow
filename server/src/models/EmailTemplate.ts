import { Schema, model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenantPlugin.js";

export interface IEmailTemplate {
  brokerageId: Types.ObjectId;
  name: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const emailTemplateSchema = new Schema<IEmailTemplate>(
  {
    brokerageId: {
      type: Schema.Types.ObjectId,
      ref: "Brokerage",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    htmlBody: {
      type: String,
      required: true,
      maxlength: 50000,
    },
    textBody: {
      type: String,
      maxlength: 50000,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

emailTemplateSchema.index(
  { brokerageId: 1, name: 1 },
  { unique: true },
);

emailTemplateSchema.plugin(tenantPlugin);

export const EmailTemplate = model<IEmailTemplate>(
  "EmailTemplate",
  emailTemplateSchema,
);
