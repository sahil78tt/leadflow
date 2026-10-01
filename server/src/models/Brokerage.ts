import { Schema, model } from "mongoose";

const brokerageSchema = new Schema(
  { name: { type: String, required: true, trim: true } },
  { timestamps: true },
);

export const Brokerage = model("Brokerage", brokerageSchema);
