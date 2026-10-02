import { tenantPlugin } from "../lib/tenantPlugin.js";
import { Schema, model, type Types } from "mongoose";

export const ROLES = [
  "platform_admin",
  "brokerage_admin",
  "advisor",
  "client",
] as const;

export type Role = (typeof ROLES)[number];

export interface IUser {
  brokerageId: Types.ObjectId | null;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
}

const userSchema = new Schema<IUser>(
  {
    brokerageId: {
      type: Schema.Types.ObjectId,
      ref: "Brokerage",
      default: null,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    role: {
      type: String,
      enum: ROLES,
      required: true,
    },
  },
  { timestamps: true },
);

userSchema.plugin(tenantPlugin);

userSchema.pre("validate", function () {
  const isPlatformAdmin = this.role === "platform_admin";

  if (isPlatformAdmin && this.brokerageId != null) {
    this.invalidate(
      "brokerageId",
      "platform_admin must not belong to a brokerage",
    );
  }

  if (!isPlatformAdmin && this.brokerageId == null) {
    this.invalidate("brokerageId", "brokerageId is required for tenant users");
  }
});

export const User = model<IUser>("User", userSchema);
