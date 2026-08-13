// Email abstraction. Every send is recorded in email_sends FIRST (the UI evidence),
// then delivered via Brevo if BREVO_API_KEY is set. Without a key, status stays "test".
// .ics attachments supported (base64) for acceptance/schedule emails.
//
// Two paths, same record: sendEmail delivers inline (small, interactive sends), and
// queueEmail writes the row now and hands delivery to the cron job runner (bulk).

import { drizzle } from "drizzle-orm/d1";
import { emailSends, events, jobs } from "../../database/schema";
import { eq } from "drizzle-orm";
import { htmlToText, renderEmailLayout } from "./email-layout";

export interface IcsAttachment {
  filename: string;
  content: string;
}

export interface OutgoingEmail {
  eventId?: number;
  templateKey?: string;
  toEmail: string;
  toContactId?: number;
  toName?: string;
  subject: string;
  bodyHtml: string;
  ics?: IcsAttachment; // raw ics text
}

export interface EmailEnv {
  DB: D1Database;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string; // verified single sender, e.g. techmaleek@gmail.com
  EMAIL_FROM_NAME?: string;
}

/** Writes the audit row. Status is "queued" when a provider key exists, "test" when
 *  it does not, so the Communications log is populated either way. */
export async function recordEmail(env: EmailEnv, mail: OutgoingEmail): Promise<number> {
  const db = drizzle(env.DB);
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
      createdAt: new Date(),
    })
    .returning({ id: emailSends.id });
  return row.id;
}

// Domains that cannot receive mail: RFC 2606 reserves example.*, .test, .invalid,
// and .localhost, and the seeded demo personas use .demo addresses. Delivering to
// them produces hard bounces, and a provider account with a high bounce rate gets
// suspended, which would take real mail down with it.
const UNDELIVERABLE = [
  /@(.+\.)?example\.(com|net|org)$/i,
  /\.(test|invalid|localhost|demo)$/i,
  /@demo\./i,
];

export function isUndeliverable(email: string): boolean {
  const address = email.trim().toLowerCase();
  return UNDELIVERABLE.some((pattern) => pattern.test(address));
}

/** Delivers an already-recorded send. Safe to call twice: a row that is already
 *  "sent" is left alone. */
export async function deliverEmail(env: EmailEnv, sendId: number, ics?: IcsAttachment): Promise<string> {
  const db = drizzle(env.DB);
  const row = await db.select().from(emailSends).where(eq(emailSends.id, sendId)).get();
  if (!row) return "failed";
  if (row.status === "sent") return "sent";
  if (!env.BREVO_API_KEY) {
    await db.update(emailSends).set({ status: "test" }).where(eq(emailSends.id, sendId));
    return "test";
  }
  if (isUndeliverable(row.toEmail)) {
    await db
      .update(emailSends)
      .set({ status: "test", error: "Recorded only: that domain cannot receive mail (demo or reserved address)." })
      .where(eq(emailSends.id, sendId));
    return "test";
  }

  // The stored body is the editable fragment; the layout is applied here so a
  // template edit never means editing table markup.
  const event = row.eventId
    ? await db.select({ name: events.name }).from(events).where(eq(events.id, row.eventId)).get()
    : null;
  const html = renderEmailLayout({
    eventName: event?.name ?? env.EMAIL_FROM_NAME ?? "OpenSession",
    bodyHtml: row.bodyHtml,
    preheader: row.subject,
    footerNote: row.icsAttached ? "A calendar invitation is attached." : undefined,
  });

  try {
    const payload: Record<string, unknown> = {
      sender: { email: env.EMAIL_FROM ?? "no-reply@example.com", name: env.EMAIL_FROM_NAME ?? "OpenSession" },
      to: [{ email: row.toEmail, name: row.toEmail }],
      subject: row.subject,
      htmlContent: html,
      textContent: htmlToText(row.bodyHtml),
    };
    if (ics) {
      payload.attachment = [{ name: ics.filename, content: btoa(unescape(encodeURIComponent(ics.content))) }];
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
      .where(eq(emailSends.id, sendId));
    return "sent";
  } catch (err) {
    await db.update(emailSends).set({ status: "failed", error: String(err) }).where(eq(emailSends.id, sendId));
    return "failed";
  }
}

export async function sendEmail(env: EmailEnv, mail: OutgoingEmail): Promise<{ id: number; status: string }> {
  const id = await recordEmail(env, mail);
  const status = await deliverEmail(env, id, mail.ics);
  return { id, status };
}

/** Records the send and leaves delivery to the cron runner. The .ics rides in the
 *  job payload so the attachment survives the hop. */
export async function queueEmail(env: EmailEnv, mail: OutgoingEmail): Promise<number> {
  const db = drizzle(env.DB);
  const id = await recordEmail(env, mail);
  await db.insert(jobs).values({
    kind: "email",
    payloadJson: JSON.stringify({ sendId: id, ics: mail.ics ?? null }),
    runAfter: new Date(),
    createdAt: new Date(),
  });
  return id;
}

// Merge tags: {speaker_name}, {first_name}, {talk_title}, {event_name}, {status},
// {portal_url}, {task_list}, {due_date}
//
// Optional blocks: {#tag}...{/tag} keeps its contents only when vars[tag] is a
// non-empty string, otherwise the whole block (tag markers included) disappears.
// Used for content like decline feedback, where an empty value must not leave a
// stray paragraph or a literal {tag} behind.
export function renderTemplate(body: string, vars: Record<string, string>): string {
  const withBlocks = body.replace(/\{#(\w+)\}([\s\S]*?)\{\/\1\}/g, (_, key: string, inner: string) => (vars[key] ? inner : ""));
  return withBlocks.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

export const MERGE_TAG_HELP =
  "Merge tags: {speaker_name}, {first_name}, {event_name}, {talk_title}, {portal_url}, {task_list}.";

/** Escapes a value before it lands in an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
