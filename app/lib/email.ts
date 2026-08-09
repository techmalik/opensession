// Email abstraction. Every send is recorded in email_sends FIRST (the UI evidence),
// then delivered via Brevo if BREVO_API_KEY is set. Without a key, status stays "test".
// .ics attachments supported (base64) for acceptance/schedule emails.

import { drizzle } from "drizzle-orm/d1";
import { emailSends } from "../../database/schema";
import { eq } from "drizzle-orm";

export interface OutgoingEmail {
  eventId?: number;
  templateKey?: string;
  toEmail: string;
  toContactId?: number;
  toName?: string;
  subject: string;
  bodyHtml: string;
  ics?: { filename: string; content: string }; // raw ics text
}

export interface EmailEnv {
  DB: D1Database;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string; // verified single sender, e.g. techmaleek@gmail.com
  EMAIL_FROM_NAME?: string;
}

export async function sendEmail(env: EmailEnv, mail: OutgoingEmail): Promise<{ id: number; status: string }> {
  const db = drizzle(env.DB);
  const now = new Date();
  const [row] = await db
    .insert(emailSends)
    .values({
      eventId: mail.eventId,
      templateKey: mail.templateKey,
      toEmail: mail.toEmail,
      toContactId: mail.toContactId,
      subject: mail.subject,
      bodyHtml: mail.bodyHtml,
      icsAttached: Boolean(mail.ics),
      status: env.BREVO_API_KEY ? "queued" : "test",
      createdAt: now,
    })
    .returning({ id: emailSends.id });

  if (!env.BREVO_API_KEY) return { id: row.id, status: "test" };

  try {
    const payload: Record<string, unknown> = {
      sender: { email: env.EMAIL_FROM ?? "no-reply@example.com", name: env.EMAIL_FROM_NAME ?? "OpenSession" },
      to: [{ email: mail.toEmail, name: mail.toName ?? mail.toEmail }],
      subject: mail.subject,
      htmlContent: mail.bodyHtml,
    };
    if (mail.ics) {
      payload.attachment = [{ name: mail.ics.filename, content: btoa(unescape(encodeURIComponent(mail.ics.content))) }];
    }
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { messageId?: string };
    await db
      .update(emailSends)
      .set({ status: "sent", sentAt: new Date(), providerId: data.messageId ?? null })
      .where(eq(emailSends.id, row.id));
    return { id: row.id, status: "sent" };
  } catch (err) {
    await db
      .update(emailSends)
      .set({ status: "failed", error: String(err) })
      .where(eq(emailSends.id, row.id));
    return { id: row.id, status: "failed" };
  }
}

// Merge tags: {speaker_name}, {talk_title}, {event_name}, {status}, {portal_url}
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}
