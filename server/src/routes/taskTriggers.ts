import { Router, type Request } from "express";
import { z } from "zod";
import { TaskTrigger } from "../models/TaskTrigger.js";
import { User } from "../models/User.js";
import { STAGES } from "../models/Lead.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { isObjectId } from "../lib/ids.js";

const router = Router();

const triggerSchema = z.object({
  stage: z.enum(STAGES),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  assignedTo: z.string().refine(isObjectId, "Invalid advisor id"),
  dueInMinutes: z.number().int().min(1).max(525600),
  enabled: z.boolean().optional(),
});

const updateSchema = triggerSchema.partial();

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function brokerageIdForAdmin(req: Request) {
  const brokerageId = req.user?.brokerageId;

  if (!brokerageId) {
    throw new Error("Brokerage admin is missing brokerage context");
  }

  return brokerageId;
}

async function verifyAdvisor(advisorId: string, brokerageId: string) {
  if (!isObjectId(advisorId)) return null;

  return User.findOne({
    _id: advisorId,
    brokerageId,
    role: "advisor",
  });
}

router.get(
  "/",
  authenticate,
  requireRole("brokerage_admin"),
  async (_req, res) => {
    const triggers = await TaskTrigger.find()
      .populate("assignedTo", "name email role")
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
        error: "Invalid task trigger",
        details: parsed.error.flatten(),
      });
    }

    const brokerageId = brokerageIdForAdmin(req);

    const advisor = await verifyAdvisor(parsed.data.assignedTo, brokerageId);

    if (!advisor) {
      return res.status(404).json({
        error: "Advisor not found in this brokerage",
      });
    }

    try {
      const trigger = await TaskTrigger.create({
        brokerageId,
        stage: parsed.data.stage,
        title: parsed.data.title,
        description: parsed.data.description,
        assignedTo: advisor._id,
        dueInMinutes: parsed.data.dueInMinutes,
        enabled: parsed.data.enabled ?? true,
      });

      await trigger.populate("assignedTo", "name email role");

      return res.status(201).json({ trigger });
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        return res.status(409).json({
          error: `A task trigger already exists for the ${parsed.data.stage} stage`,
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
        error: "Invalid task trigger",
        details: parsed.error.flatten(),
      });
    }

    const brokerageId = brokerageIdForAdmin(req);

    if (parsed.data.assignedTo) {
      const advisor = await verifyAdvisor(parsed.data.assignedTo, brokerageId);

      if (!advisor) {
        return res.status(404).json({
          error: "Advisor not found in this brokerage",
        });
      }
    }

    try {
      const trigger = await TaskTrigger.findOneAndUpdate(
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
      ).populate("assignedTo", "name email role");

      if (!trigger) {
        return res.status(404).json({ error: "Not found" });
      }

      return res.json({ trigger });
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        return res.status(409).json({
          error: "Another task trigger already uses this stage",
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

    const deleted = await TaskTrigger.findOneAndDelete({
      _id: triggerId,
      brokerageId: brokerageIdForAdmin(req),
    });

    if (!deleted) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ ok: true });
  },
);

export default router;
