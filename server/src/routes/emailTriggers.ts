import { Router } from "express";
import { z } from "zod";
import { EmailTemplate } from "../models/EmailTemplate.js";
import { EmailTrigger } from "../models/EmailTrigger.js";
import { STAGES } from "../models/Lead.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { isObjectId } from "../lib/ids.js";

const router = Router();

const triggerSchema = z.object({
  stage: z.enum(STAGES),
  templateId: z.string().refine(isObjectId, "Invalid template id"),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  stage: z.enum(STAGES).optional(),
  templateId: z.string().refine(isObjectId, "Invalid template id").optional(),
  enabled: z.boolean().optional(),
});

function brokerageIdForAdmin(req: Parameters<typeof router.get>[1] extends (
  ...args: infer A
) => any
  ? A[0]
  : never) {
  const brokerageId = req.user?.brokerageId;

  if (!brokerageId) {
    throw new Error("Brokerage admin is missing brokerage context");
  }

  return brokerageId;
}

async function verifyTemplate(
  templateId: string,
  brokerageId: string,
) {
  if (!isObjectId(templateId)) return null;

  return EmailTemplate.findOne({
    _id: templateId,
    brokerageId,
  });
}

router.get(
  "/",
  authenticate,
  requireRole("brokerage_admin"),
  async (_req, res) => {
    const triggers = await EmailTrigger.find()
      .populate("templateId", "name subject enabled")
      .sort({ stage: 1 })
      .lean();

    return res.json({ triggers });
  },
);

router.post(
  "/",
  authenticate,
  requireRole("brokerage_admin"),
  async (req, res) => {
    const parsed = triggerSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid email trigger",
        details: parsed.error.flatten(),
      });
    }

    const brokerageId = brokerageIdForAdmin(req);

    const template = await verifyTemplate(
      parsed.data.templateId,
      brokerageId,
    );

    if (!template) {
      return res.status(404).json({
        error: "Email template not found",
      });
    }

    try {
      const trigger = await EmailTrigger.create({
        brokerageId,
        stage: parsed.data.stage,
        templateId: parsed.data.templateId,
        enabled: parsed.data.enabled ?? true,
      });

      await trigger.populate("templateId", "name subject enabled");

      return res.status(201).json({ trigger });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res.status(409).json({
          error: `An email trigger already exists for the ${parsed.data.stage} stage`,
        });
      }

      throw error;
    }
  },
);

router.patch(
  "/:triggerId",
  authenticate,
  requireRole("brokerage_admin"),
  async (req, res) => {
    const triggerId = String(req.params.triggerId);

    if (!isObjectId(triggerId)) {
      return res.status(404).json({ error: "Not found" });
    }

    const parsed = updateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid email trigger",
        details: parsed.error.flatten(),
      });
    }

    const brokerageId = brokerageIdForAdmin(req);

    if (parsed.data.templateId) {
      const template = await verifyTemplate(
        parsed.data.templateId,
        brokerageId,
      );

      if (!template) {
        return res.status(404).json({
          error: "Email template not found",
        });
      }
    }

    try {
      const trigger = await EmailTrigger.findOneAndUpdate(
        {
          _id: triggerId,
          brokerageId,
        },
        {
          $set: parsed.data,
        },
        {
          new: true,
          runValidators: true,
        },
      ).populate("templateId", "name subject enabled");

      if (!trigger) {
        return res.status(404).json({ error: "Not found" });
      }

      return res.json({ trigger });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res.status(409).json({
          error: "Another email trigger already uses this stage",
        });
      }

      throw error;
    }
  },
);

router.delete(
  "/:triggerId",
  authenticate,
  requireRole("brokerage_admin"),
  async (req, res) => {
    const triggerId = String(req.params.triggerId);

    if (!isObjectId(triggerId)) {
      return res.status(404).json({ error: "Not found" });
    }

    const deleted = await EmailTrigger.findOneAndDelete({
      _id: triggerId,
    });

    if (!deleted) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ ok: true });
  },
);

export default router;
