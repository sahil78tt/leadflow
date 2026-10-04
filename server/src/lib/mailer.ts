import { env } from "../config/env.js";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  configured(): boolean;
  send(message: EmailMessage): Promise<{ id: string }>;
}

// Resend's shared test sender only delivers to the email address of your own Resend account.
const FROM = env.EMAIL_FROM ?? "LeadFlow <onboarding@resend.dev>";

async function sendViaResend(message: EmailMessage) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: AbortSignal.timeout(8000), // a hung provider must not hold a background job forever
  });
  const body = (await res.json().catch(() => null)) as {
    id?: string;
    message?: string;
  } | null;
  if (!res.ok || !body?.id)
    throw new Error(
      `Resend ${res.status}: ${body?.message ?? "unexpected response"}`,
    );
  return { id: body.id };
}

// An object (not bare functions) so tests can swap it without touching the network.
export const mailer: Mailer = {
  configured: () => Boolean(env.RESEND_API_KEY),
  send: sendViaResend,
};
