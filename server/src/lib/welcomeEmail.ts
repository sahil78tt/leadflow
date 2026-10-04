import { Brokerage } from "../models/Brokerage.js";
import { Lead } from "../models/Lead.js";
import { mailer } from "./mailer.js";
import { tenantStorage } from "./tenantContext.js";

// The webhook is public, so outbound email needs a ceiling. Per brokerage, per UTC day. Tunable for tests.
export const emailConfig = { dailyCapPerBrokerage: 25 };

export interface WelcomeTarget {
  id: string;
  brokerageId: string;
  name: string;
  email?: string;
}

export type WelcomeOutcome =
  | "sent"
  | "failed"
  | "skipped"
  | "already_handled"
  | "rate_limited";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// The one hardcoded template. The lead's name came from an unauthenticated form, so it is escaped.
function welcomeContent(name: string, brokerageName: string) {
  const text = [
    `Hi ${name},`,
    "",
    `Thank you for your interest in a mortgage consultation with ${brokerageName}. We have received your request and an advisor will be in touch shortly.`,
    "",
    `You are receiving this email because you asked ${brokerageName} to contact you.`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#171717;line-height:1.5">
<p>Hi ${escapeHtml(name)},</p>
<p>Thank you for your interest in a mortgage consultation with <strong>${escapeHtml(brokerageName)}</strong>. We have received your request and an advisor will be in touch shortly.</p>
<p style="color:#666;font-size:12px">You are receiving this email because you asked ${escapeHtml(brokerageName)} to contact you.</p>
</body></html>`;
  return { text, html };
}

/**
 * Sends the welcome email for a lead that just entered New. Never throws and never blocks the caller's work:
 * callers do not await it. At most one email per lead: the claim below is atomic, and only a previously
 * FAILED attempt can be claimed again (a crash mid-send leaves "sending", which is never retried on purpose:
 * better no email than two).
 */
export async function sendWelcomeEmail(
  target: WelcomeTarget,
): Promise<WelcomeOutcome> {
  if (!target.email || !mailer.configured()) return "skipped"; // phone-only lead, or email is switched off
  const email = target.email;
  try {
    // Runs inside its own tenant (the public webhook has none), so every query is scoped without any opt-out.
    return await tenantStorage.run(
      { brokerageId: target.brokerageId, role: "system" },
      async () => {
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);
        const attemptsToday = await Lead.countDocuments({
          "welcomeEmail.at": { $gte: startOfDay },
        });
        if (attemptsToday >= emailConfig.dailyCapPerBrokerage) {
          console.warn(
            `welcome email skipped: daily cap reached for brokerage ${target.brokerageId}`,
          );
          return "rate_limited" as const;
        }

        const claimed = await Lead.findOneAndUpdate(
          {
            _id: target.id,
            $or: [
              { "welcomeEmail.status": { $exists: false } },
              { "welcomeEmail.status": "failed" },
            ],
          },
          { $set: { welcomeEmail: { status: "sending", at: new Date() } } },
        );
        if (!claimed) return "already_handled" as const;

        const brokerage = await Brokerage.findById(target.brokerageId);
        const brokerageName = brokerage?.name ?? "your mortgage advisor";
        try {
          const { text, html } = welcomeContent(target.name, brokerageName);
          const { id } = await mailer.send({
            to: email,
            subject: `Welcome to ${brokerageName}`,
            text,
            html,
          });
          await Lead.updateOne(
            { _id: target.id },
            {
              $set: {
                "welcomeEmail.status": "sent",
                "welcomeEmail.resendId": id,
                "welcomeEmail.at": new Date(),
              },
            },
          );
          return "sent" as const;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          await Lead.updateOne(
            { _id: target.id },
            {
              $set: {
                "welcomeEmail.status": "failed",
                "welcomeEmail.error": reason.slice(0, 300),
              },
            },
          );
          return "failed" as const;
        }
      },
    );
  } catch (err) {
    console.error("welcome email crashed", target.id, err);
    return "failed";
  }
}
