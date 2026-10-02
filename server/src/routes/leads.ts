import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Brokerage } from "../models/Brokerage.js";
import { Lead } from "../models/Lead.js";
import { normalizeEmail, normalizePhone } from "../lib/normalize.js";

const router = Router();

const OBJECT_ID = /^[a-f\d]{24}$/i;

const webhookSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z
      .union([z.literal(""), z.string().trim().email().max(254)])
      .optional(),
    phone: z.string().trim().max(40).optional(),
    source: z.string().trim().max(100).optional(),
  })
  .transform((b) => ({
    name: b.name,
    email: normalizeEmail(b.email),
    phone: normalizePhone(b.phone),
    source: b.source || undefined,
  }))
  .refine((b) => Boolean(b.email || b.phone), {
    message: "A valid email or phone is required",
  });

const idempotencyKeySchema = z.string().trim().min(1).max(255).optional();

const isDuplicateKeyError = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  err.code === 11000;

// Public endpoint: the tenant comes from the URL, there is no JWT and no tenant context.
router.post("/webhook/:brokerageId", async (req, res) => {
  const { brokerageId } = req.params;
  if (!OBJECT_ID.test(brokerageId))
    return res.status(404).json({ error: "Not found" });

  const body = webhookSchema.parse(req.body);
  const idempotencyKey = idempotencyKeySchema.parse(
    req.header("Idempotency-Key"),
  );

  if (!(await Brokerage.exists({ _id: brokerageId })))
    return res.status(404).json({ error: "Not found" });

  try {
    await Lead.create({
      ...body,
      brokerageId: new Types.ObjectId(brokerageId),
      idempotencyKey,
    });
  } catch (err) {
    // Any unique-index hit (same email, same phone, or same idempotency key) means we already have this lead.
    if (!isDuplicateKeyError(err)) throw err;
  }

  // Identical response for "created" and "duplicate": the caller must not learn whether a lead already exists.
  res.status(202).json({ received: true });
});

export default router;
