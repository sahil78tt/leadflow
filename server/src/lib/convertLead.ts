import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import mongoose, { Types, type HydratedDocument } from "mongoose";
import { Client, type IClient } from "../models/Client.js";
import { Lead, type ILead } from "../models/Lead.js";
import { User } from "../models/User.js";

export type ConvertResult =
  | {
      ok: true;
      lead: HydratedDocument<ILead>;
      client: HydratedDocument<IClient>;
      temporaryPassword: string;
    }
  | { ok: false; reason: "not_found" | "email_taken" }
  | {
      ok: false;
      reason: "already_converted" | "conflict";
      lead: HydratedDocument<ILead>;
    };

const isDuplicateEmail = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  err.code === 11000 &&
  "keyPattern" in err &&
  typeof err.keyPattern === "object" &&
  err.keyPattern !== null &&
  "email" in err.keyPattern;

/**
 * Claims the lead (compare-and-set on version, and only if not yet converted), creates the client and
 * its portal login, all in ONE transaction: a failure anywhere leaves nothing behind.
 * Runs inside the caller's tenant context, so every query below is tenant-scoped by tenantPlugin.
 */
export async function convertLead(input: {
  leadId: string;
  version: number;
  email: string;
  advisorId: string;
}): Promise<ConvertResult> {
  // Hash before the transaction so it stays short.
  const temporaryPassword = randomBytes(9).toString("base64url");
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  const clientId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  const box: { result?: ConvertResult } = {};
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      box.result = undefined; // the callback can run again after a transient error
      const lead = await Lead.findOneAndUpdate(
        {
          _id: input.leadId,
          version: input.version,
          clientId: { $exists: false },
        },
        { $set: { stage: "won", clientId }, $inc: { version: 1 } },
        { new: true, session },
      );
      if (!lead) return; // nothing was written; classified below

      const [client] = await Client.create(
        [
          {
            _id: clientId,
            brokerageId: lead.brokerageId,
            leadId: lead._id,
            userId,
            advisorId: new Types.ObjectId(input.advisorId),
            name: lead.name,
            email: input.email,
            phone: lead.phone,
          },
        ],
        { session },
      );
      await User.create(
        [
          {
            _id: userId,
            brokerageId: lead.brokerageId,
            name: lead.name,
            email: input.email,
            role: "client",
            passwordHash,
          },
        ],
        { session },
      );
      box.result = { ok: true, lead, client, temporaryPassword };
    });
  } catch (err) {
    // The transaction was rolled back, including the lead update.
    if (isDuplicateEmail(err)) return { ok: false, reason: "email_taken" };
    throw err;
  } finally {
    await session.endSession();
  }
  if (box.result) return box.result;

  const current = await Lead.findById(input.leadId);
  if (!current) return { ok: false, reason: "not_found" };
  return {
    ok: false,
    reason: current.clientId ? "already_converted" : "conflict",
    lead: current,
  };
}
