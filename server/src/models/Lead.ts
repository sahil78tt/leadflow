import { Schema, model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenantPlugin.js";

// Placeholder pipeline; confirm or rename before the board goes live.
export const STAGES = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
] as const;
export type Stage = (typeof STAGES)[number];

export interface IWelcomeEmail {
  status: "sending" | "sent" | "failed";
  at: Date;
  resendId?: string;
  error?: string;
}

export interface ILead {
  brokerageId: Types.ObjectId;
  name: string;
  email?: string; // normalized (lowercase)
  phone?: string; // normalized (+<digits>)
  source?: string;
  stage: Stage;
  version: number; // optimistic concurrency
  idempotencyKey?: string;
  clientId?: Types.ObjectId; // set once the lead has been converted
  welcomeEmail?: IWelcomeEmail; // never returned by the API; does not touch `version`
  createdAt?: Date;
  updatedAt?: Date;
}

const welcomeEmailSchema = new Schema<IWelcomeEmail>(
  {
    status: { type: String, enum: ["sending", "sent", "failed"] },
    at: { type: Date },
    resendId: { type: String },
    error: { type: String },
  },
  { _id: false },
);

const leadSchema = new Schema<ILead>(
  {
    brokerageId: {
      type: Schema.Types.ObjectId,
      ref: "Brokerage",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, trim: true, maxlength: 20 },
    source: { type: String, trim: true, maxlength: 100 },
    stage: { type: String, enum: STAGES, default: "new" },
    version: { type: Number, default: 0 },
    idempotencyKey: { type: String, select: false },
    clientId: { type: Schema.Types.ObjectId, ref: "Client" },
    welcomeEmail: { type: welcomeEmailSchema, select: false },
  },
  { timestamps: true },
);

// Duplicate detection lives in the database so concurrent submissions cannot both succeed.
// Partial filters: a lead without an email (or phone, or key) must not collide with other such leads.
const present = (field: string) => ({
  partialFilterExpression: { [field]: { $type: "string" } },
});
leadSchema.index(
  { brokerageId: 1, email: 1 },
  { unique: true, ...present("email") },
);
leadSchema.index(
  { brokerageId: 1, phone: 1 },
  { unique: true, ...present("phone") },
);
leadSchema.index(
  { brokerageId: 1, idempotencyKey: 1 },
  { unique: true, ...present("idempotencyKey") },
);
leadSchema.index({ brokerageId: 1, createdAt: -1 }); // board listing
leadSchema.index({ brokerageId: 1, stage: 1 }); // dashboard counts
leadSchema.index(
  { brokerageId: 1, "welcomeEmail.at": 1 },
  { partialFilterExpression: { "welcomeEmail.at": { $exists: true } } },
); // the daily email cap

leadSchema.plugin(tenantPlugin);

export const Lead = model<ILead>("Lead", leadSchema);
