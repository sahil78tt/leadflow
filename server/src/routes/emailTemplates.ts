import { Router } from "express";
import { z } from "zod";
import { EmailTemplate } from "../models/EmailTemplate.js";
import { authenticate, requireRole } from "../middleware/auth.js";
import { isObjectId } from "../lib/ids.js";

const router = Router();

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(300),
  htmlBody: z.string().min(1).max(50000),
  textBody: z.string().max(50000).optional(),
  enabled: z.boolean().optional(),
});

const updateSchema = templateSchema.partial();

const PLACEHOLDERS = [
  "clientName",
  "advisorName",
  "leadName",
  "brokerageName",
] as const;

function renderTemplate(
  value: string,
  data: Record<(typeof PLACEHOLDERS)[number], string>,
) {
  return value.replace(
    /\{\{\s*(clientName|advisorName|leadName|brokerageName)\s*\}\}/g,
    (_match, key) => data[key as keyof typeof data],
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

router.get(
  "/",
  authenticate,
  requireRole("brokerage_admin"),
  async (_req, res) => {
    const templates = await EmailTemplate.find()
      .sort({ createdAt: -1 })
      .lean();

    res.json({ templates });
  },
);

router.post(
  "/",
  authenticate,
  requireRole("brokerage_admin"),
  async (req, res) => {
    const parsed = templateSchema.safeParse(req.body);

    if (!parsed.success)
      return res.status(400).json({
        error: "Invalid template",
        details: parsed.error.flatten(),
      });

    const brokerageId = brokerageIdForAdmin(req);

    try {
      const template = await EmailTemplate.create({
        ...parsed.data,
        brokerageId,
      });

      return res.status(201).json({ template });
    } catch (error: any) {
      if (error?.code === 11000)
        return res.status(409).json({
          error: "A template with this name already exists",
        });
      throw error;
    }
  },
);

router.patch(
  "/:templateId",
  authenticate,
  requireRole("brokerage_admin"),
  async (req, res) => {
    const templateId = String(req.params.templateId);

    if (!isObjectId(templateId))
      return res.status(404).json({ error: "Not found" });

    const parsed = updateSchema.safeParse(req.body);

    if (!parsed.success)
      return res.status(400).json({
        error: "Invalid template",
        details: parsed.error.flatten(),
      });

    try {
      const template = await EmailTemplate.findByIdAndUpdate(
        templateId,
        { $set: parsed.data },
        { new: true, runValidators: true },
      );

      if (!template) return res.status(404).json({ error: "Not found" });

      return res.json({ template });
    } catch (error: any) {
      if (error?.code === 11000)
        return res.status(409).json({
          error: "A template with this name already exists",
        });
      throw error;
    }
  },
);

router.delete(
  "/:templateId",
  authenticate,
  requireRole("brokerage_admin"),
  async (req, res) => {
    const templateId = String(req.params.templateId);

    if (!isObjectId(templateId))
      return res.status(404).json({ error: "Not found" });

    const deleted = await EmailTemplate.findByIdAndDelete(templateId);

    if (!deleted) return res.status(404).json({ error: "Not found" });

    return res.json({ ok: true });
  },
);

router.post(
  "/:templateId/preview",
  authenticate,
  requireRole("brokerage_admin"),
  async (req, res) => {
    const templateId = String(req.params.templateId);

    if (!isObjectId(templateId))
      return res.status(404).json({ error: "Not found" });

    const template = await EmailTemplate.findById(templateId).lean();

    if (!template) return res.status(404).json({ error: "Not found" });

    const sample = {
      clientName: escapeHtml(
        String(req.body?.clientName ?? "Alex Client"),
      ),
      advisorName: escapeHtml(
        String(req.body?.advisorName ?? "Jordan Advisor"),
      ),
      leadName: escapeHtml(
        String(req.body?.leadName ?? "Alex Client"),
      ),
      brokerageName: escapeHtml(
        String(req.body?.brokerageName ?? "Your Brokerage"),
      ),
    };

    const subject = renderTemplate(template.subject, sample);
    const htmlBody = renderTemplate(template.htmlBody, sample);
    const textBody = template.textBody
      ? renderTemplate(template.textBody, sample)
      : undefined;

    return res.json({
      subject,
      htmlBody,
      textBody,
    });
  },
);

export default router;
