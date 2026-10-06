import { Router } from "express";
import { Types, type HydratedDocument } from "mongoose";
import { z } from "zod";
import { Brokerage } from "../models/Brokerage.js";
import { Lead, STAGES, type ILead } from "../models/Lead.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { publishLeadChange } from "../lib/leadEvents.js"; // <-- SWAP 1: was emitLeadChanged from socket.js
import { emitLeadDuplicate } from "../lib/socket.js";
import { tenantStorage } from "../lib/tenantContext.js";
import { normalizeEmail, normalizePhone } from "../lib/normalize.js";
import { convertLead } from "../lib/convertLead.js";
import { sendWelcomeEmail } from "../lib/welcomeEmail.js";
import { env } from "../config/env.js";

const router = Router();

const OBJECT_ID = /^[a-f\d]{24}$/i;
const MAX_BOARD_LEADS = 500;

const publicLead = (l: HydratedDocument<ILead>) => ({
  id: l.id as string,
  name: l.name,
  email: l.email,
  phone: l.phone,
  source: l.source,
  stage: l.stage,
  version: l.version,
  createdAt: l.createdAt,
  clientId: l.clientId?.toString(),
});

const welcomeTarget = (l: HydratedDocument<ILead>) => ({
  id: l.id as string,
  brokerageId: l.brokerageId.toString(),
  name: l.name,
  email: l.email,
});
/* ----------------------------- Board (authenticated) ----------------------------- */
// Tenant scoping comes from tenantPlugin via the context set in `authenticate`; no manual brokerageId filters here.

router.get(
  "/",
  authenticate,
  requireRole("advisor", "brokerage_admin"),
  async (_req, res) => {
    const leads = await Lead.find()
      .sort({ createdAt: -1 })
      .limit(MAX_BOARD_LEADS);
    res.json({ leads: leads.map(publicLead) });
  },
);

const moveSchema = z.object({
  stage: z.enum(STAGES),
  version: z.number().int().min(0),
});

router.patch(
  "/:id/stage",
  authenticate,
  requireRole("advisor", "brokerage_admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!OBJECT_ID.test(id))
      return res.status(404).json({ error: "Not found" });
    const { stage, version } = moveSchema.parse(req.body);

    // Atomic compare-and-set: only succeeds if the caller saw the latest version. A cross-tenant id matches nothing.
    // Converted leads (they have a clientId) are locked.
    const updated = await Lead.findOneAndUpdate(
      { _id: id, version, stage: { $ne: stage }, clientId: { $exists: false } },
      { $set: { stage }, $inc: { version: 1 } },
      { new: true },
    );
    if (updated) {
      const lead = publicLead(updated);
      await publishLeadChange(updated.brokerageId.toString(), lead); // everyone on this brokerage's board
      // Not awaited: a slow or failing email never delays or fails the move.
      if (stage === "new") void sendWelcomeEmail(welcomeTarget(updated));
      return res.json({ lead });
    }

    // No match: not found (or another tenant's), already in that stage (no-op), converted, or moved by someone else.
    // None of these changed anything, so none of them are broadcast.
    const current = await Lead.findById(id);
    if (!current) return res.status(404).json({ error: "Not found" });
    if (current.version === version && current.stage === stage)
      return res.json({ lead: publicLead(current) });
    if (current.clientId) {
      return res.status(422).json({
        error: "Converted leads cannot be moved",
        lead: publicLead(current),
      });
    }
    res.status(409).json({
      error: "Lead was changed by someone else",
      lead: publicLead(current),
    });
  },
);

const convertSchema = z.object({
  version: z.number().int().min(0),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
});

router.post(
  "/:id/convert",
  authenticate,
  requireRole("advisor", "brokerage_admin"),
  async (req, res) => {
    const id = String(req.params.id);
    if (!OBJECT_ID.test(id))
      return res.status(404).json({ error: "Not found" });
    const { version, email } = convertSchema.parse(req.body);

    const result = await convertLead({
      leadId: id,
      version,
      email,
      advisorId: req.user!.id,
    });

    if (result.ok) {
      const lead = publicLead(result.lead);
      await publishLeadChange(result.lead.brokerageId.toString(), lead); // <-- SWAP 3: was emitLeadChanged
      res.set("Cache-Control", "no-store"); // the response carries a one-time password
      return res.status(201).json({
        lead,
        client: { id: result.client.id as string, name: result.client.name },
        portal: { email, temporaryPassword: result.temporaryPassword },
      });
    }

    switch (result.reason) {
      case "not_found":
        return res.status(404).json({ error: "Not found" });
      case "already_converted":
        return res.status(409).json({
          error: "This lead is already a client",
          lead: publicLead(result.lead),
        });
      case "conflict":
        return res.status(409).json({
          error: "Lead was changed by someone else",
          lead: publicLead(result.lead),
        });
      case "email_taken":
        // Deliberately vague: emails are globally unique, so a specific message would reveal other brokerages' users.
        return res
          .status(409)
          .json({ error: "This email cannot be used for a portal login" });
    }
  },
);

/* ------------------------------ Webhook (public) ------------------------------ */

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

  // Optional shared-secret protection.
  // Local development continues to work when WEBHOOK_SECRET is not configured.
  if (env.WEBHOOK_SECRET) {
    const providedSecret = req.header("X-Webhook-Secret");

    if (providedSecret !== env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Invalid webhook secret" });
    }
  }

  const body = webhookSchema.parse(req.body);
  const idempotencyKey = idempotencyKeySchema.parse(
    req.header("Idempotency-Key"),
  );

  if (!(await Brokerage.exists({ _id: brokerageId })))
    return res.status(404).json({ error: "Not found" });

  let created: HydratedDocument<ILead> | undefined;
  let duplicate: HydratedDocument<ILead> | null = null;

  try {
    created = await Lead.create({
      ...body,
      brokerageId: new Types.ObjectId(brokerageId),
      idempotencyKey,
    });
  } catch (err) {
    // Any unique-index hit (same email, same phone, or same idempotency key)
    // means we already have this lead.
    if (!isDuplicateKeyError(err)) throw err;

    // The public webhook has no authenticated tenant context.
    // Establish the brokerage explicitly for this lookup so the tenant plugin
    // cannot accidentally read another brokerage's leads.
    duplicate = await tenantStorage.run(
      { brokerageId, role: "webhook" },
      async () => {
        const match: Record<string, unknown>[] = [];

        if (body.email) match.push({ email: body.email });
        if (body.phone) match.push({ phone: body.phone });
        if (idempotencyKey) match.push({ idempotencyKey });

        if (match.length === 0) return null;

        return Lead.findOne({ $or: match });
      },
    );
  }

  if (created) {
    await publishLeadChange(brokerageId, publicLead(created));

    // A new lead starts in New; not awaited so email failures do not break ingestion.
    void sendWelcomeEmail(welcomeTarget(created));
  } else if (duplicate) {
    // Notify only staff belonging to this brokerage.
    // The external caller still receives the same neutral response.
    emitLeadDuplicate(brokerageId, publicLead(duplicate));
  }

  // Identical response for created and duplicate.
  // The external caller must not learn whether a lead already exists.
  res.status(202).json({ received: true });
});

export default router;
