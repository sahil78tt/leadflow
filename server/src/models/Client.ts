import { Schema, model, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenantPlugin.js";

export interface IClient {
  brokerageId: Types.ObjectId;
  leadId: Types.ObjectId;
  userId: Types.ObjectId; // the client's portal login
  advisorId: Types.ObjectId; // the advisor who converted the lead
  name: string;
  email: string;
  phone?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const clientSchema = new Schema<IClient>(
  {
    brokerageId: {
      type: Schema.Types.ObjectId,
      ref: "Brokerage",
      required: true,
      index: true,
    },
    leadId: { type: Schema.Types.ObjectId, ref: "Lead", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    advisorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    phone: { type: String, trim: true, maxlength: 20 },
  },
  { timestamps: true },
);

clientSchema.index({ brokerageId: 1, leadId: 1 }, { unique: true }); // a lead converts at most once
clientSchema.index({ userId: 1 }, { unique: true }); // a login belongs to exactly one client

clientSchema.plugin(tenantPlugin);

export const Client = model<IClient>("Client", clientSchema);
