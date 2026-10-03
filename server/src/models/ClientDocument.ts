import { Schema, model, type HydratedDocument, type Types } from "mongoose";
import { tenantPlugin } from "../lib/tenantPlugin.js";

export const DOC_STATUSES = [
  "pending",
  "checking",
  "verified",
  "failed",
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export interface IClientDocument {
  brokerageId: Types.ObjectId;
  clientId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  filename: string;
  mimeType: string;
  size: number;
  publicId: string; // Cloudinary reference; never returned by the API
  format: string;
  status: DocStatus;
  failureReason?: string;
  checkedAt?: Date;
  version: number; // bumped on every status change so clients can ignore stale socket events
  createdAt?: Date;
  updatedAt?: Date;
}

const clientDocumentSchema = new Schema<IClientDocument>(
  {
    brokerageId: {
      type: Schema.Types.ObjectId,
      ref: "Brokerage",
      required: true,
      index: true,
    },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    filename: { type: String, required: true, trim: true, maxlength: 120 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    publicId: { type: String, required: true, select: false },
    format: { type: String, required: true, select: false },
    status: { type: String, enum: DOC_STATUSES, default: "pending" },
    failureReason: { type: String },
    checkedAt: { type: Date },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

clientDocumentSchema.index({ brokerageId: 1, clientId: 1, createdAt: -1 });
clientDocumentSchema.index({ status: 1 }); // restart recovery

clientDocumentSchema.plugin(tenantPlugin);

export const ClientDocument = model<IClientDocument>(
  "ClientDocument",
  clientDocumentSchema,
  "documents",
);

export const publicDocument = (d: HydratedDocument<IClientDocument>) => ({
  id: d.id as string,
  clientId: d.clientId.toString(),
  filename: d.filename,
  mimeType: d.mimeType,
  size: d.size,
  status: d.status,
  failureReason: d.failureReason,
  version: d.version,
  createdAt: d.createdAt,
});
