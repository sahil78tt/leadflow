import { Types } from "mongoose";
import { Brokerage } from "../models/Brokerage.js";
import { Client } from "../models/Client.js";
import { EmailDelivery } from "../models/EmailDelivery.js";
import { EmailTemplate } from "../models/EmailTemplate.js";
import { EmailTrigger } from "../models/EmailTrigger.js";
import { Lead, type Stage } from "../models/Lead.js";
import { User } from "../models/User.js";
import { mailer } from "./mailer.js";
import { tenantStorage } from "./tenantContext.js";
import { sendWelcomeEmail } from "./welcomeEmail.js";

export interface StageAutomationTarget {
  leadId: string;
  brokerageId: string;
  stage: Stage;
  actorId?: string;
}

export type StageEmailOutcome =
  | "sent"
  | "failed"
  | "skipped"
  | "already_handled"
  | "fallback_welcome"
  | "rate_limited";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderTemplate = (
  value: string,
  data: {
    clientName: string;
    advisorName: string;
    leadName: string;
    brokerageName: string;
  },
) =>
  value.replace(
    /\{\{\s*(clientName|advisorName|leadName|brokerageName)\s*\}\}/g,
    (_match, key: keyof typeof data) => data[key],
  );

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

async function sendConfiguredStageEmail(
  target: StageAutomationTarget,
): Promise<StageEmailOutcome | null> {
  const brokerageObjectId = new Types.ObjectId(target.brokerageId);
  const leadObjectId = new Types.ObjectId(target.leadId);

  const trigger = await EmailTrigger.findOne({
    brokerageId: brokerageObjectId,
    stage: target.stage,
    enabled: true,
  });

  // No custom trigger: caller may use the existing New-stage welcome fallback.
  if (!trigger) return null;

  if (!mailer.configured()) return "skipped";

  const template = await EmailTemplate.findOne({
    _id: trigger.templateId,
    brokerageId: brokerageObjectId,
    enabled: true,
  });

  if (!template) return "skipped";

  const lead = await Lead.findById(leadObjectId);

  if (!lead?.email) return "skipped";

  const brokerage = await Brokerage.findById(brokerageObjectId);

  const client = lead.clientId
    ? await Client.findOne({
        _id: lead.clientId,
        brokerageId: brokerageObjectId,
      })
    : null;

  const advisor = target.actorId && Types.ObjectId.isValid(target.actorId)
    ? await User.findOne({
        _id: target.actorId,
        brokerageId: brokerageObjectId,
        role: { $in: ["advisor", "brokerage_admin"] },
      })
    : null;

  const values = {
    clientName: escapeHtml(client?.name ?? lead.name),
    advisorName: escapeHtml(advisor?.name ?? "Your advisor"),
    leadName: escapeHtml(lead.name),
    brokerageName: escapeHtml(brokerage?.name ?? "your brokerage"),
  };

  let claimed;

  // Retry a previously failed delivery atomically.
  const retryClaim = await EmailDelivery.findOneAndUpdate(
    {
      brokerageId: brokerageObjectId,
      leadId: leadObjectId,
      triggerId: trigger._id,
      status: "failed",
    },
    {
      $set: {
        stage: target.stage,
        status: "sending",
        at: new Date(),
        error: undefined,
      },
    },
    {
      new: true,
    },
  );

  if (retryClaim) {
    claimed = retryClaim;
  } else {
    // First delivery: exactly one concurrent caller wins the unique index.
    try {
      claimed = await EmailDelivery.create({
        brokerageId: brokerageObjectId,
        leadId: leadObjectId,
        triggerId: trigger._id,
        stage: target.stage,
        status: "sending",
        at: new Date(),
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return "already_handled";
      }

      throw error;
    }
  }

  try {
    const subject = renderTemplate(template.subject, values);
    const html = renderTemplate(template.htmlBody, values);
    const text = template.textBody
      ? renderTemplate(template.textBody, values)
      : html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const { id } = await mailer.send({
      to: lead.email,
      subject,
      html,
      text,
    });

    await EmailDelivery.updateOne(
      {
        _id: claimed._id,
        status: "sending",
      },
      {
        $set: {
          status: "sent",
          resendId: id,
          at: new Date(),
        },
      },
    );

    return "sent";
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    await EmailDelivery.updateOne(
      {
        _id: claimed._id,
        status: "sending",
      },
      {
        $set: {
          status: "failed",
          error: reason.slice(0, 300),
          at: new Date(),
        },
      },
    );

    return "failed";
  }
}

export async function processStageEmail(
  target: StageAutomationTarget,
): Promise<StageEmailOutcome> {
  try {
    return await tenantStorage.run(
      {
        brokerageId: target.brokerageId,
        role: "system",
      },
      async () => {
        const result = await sendConfiguredStageEmail(target);

        if (result) return result;

        // Preserve the existing welcome-email behaviour when there is
        // no custom trigger configured for New.
        if (target.stage === "new") {
          const lead = await Lead.findById(target.leadId);

          if (!lead) return "skipped";

          const outcome = await sendWelcomeEmail({
            id: lead.id as string,
            brokerageId: target.brokerageId,
            name: lead.name,
            email: lead.email,
          });

          return outcome === "sent"
            ? "fallback_welcome"
            : outcome;
        }

        return "skipped";
      },
    );
  } catch (error) {
    console.error(
      "stage email automation crashed",
      target.leadId,
      target.stage,
      error,
    );

    return "failed";
  }
}
