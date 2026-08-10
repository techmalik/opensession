// Templates, merge variables, and bulk queueing. Every organizer-facing send goes
// through here so the Communications log and the merge-tag vocabulary stay identical
// wherever the send was triggered from.

import { and, desc, eq } from "drizzle-orm";
import { appBaseUrl, bindings, getDb } from "./db.server";
import { queueEmail, renderTemplate, type IcsAttachment } from "./email";
import { emailSends, emailTemplates } from "../../database/schema";

export interface TemplateBody {
  key: string;
  name: string;
  subject: string;
  body: string;
}

/** Built-in copy used when an event has no row for the key yet, so an event created
 *  before a template existed never lands on an empty compose form. */
const BUILT_IN: Record<string, TemplateBody> = {
  portal_invite: {
    key: "portal_invite",
    name: "Speaker portal invite",
    subject: "Your speaker portal for {event_name}",
    body:
      "<p>Hi {first_name},</p><p>Your speaker portal for {event_name} is open. Complete your profile, confirm your sessions, and work through your task list there.</p><p>{portal_url}</p>",
  },
  speaker_welcome: {
    key: "speaker_welcome",
    name: "Speaker welcome",
    subject: "Welcome to {event_name} speakers",
    body:
      "<p>Hi {first_name},</p><p>Welcome to {event_name}. Everything you need is in your speaker portal: your sessions, your profile, and your task list.</p><p>{portal_url}</p>",
  },
  deliverables_reminder: {
    key: "deliverables_reminder",
    name: "Deliverables reminder",
    subject: "Still outstanding for {event_name}",
    body:
      "<p>Hi {first_name},</p><p>These are still outstanding for {event_name}:</p>{task_list}<p>You can upload them from your portal.</p><p>{portal_url}</p>",
  },
  schedule: {
    key: "schedule",
    name: "Schedule notice",
    subject: "Your session is scheduled: {talk_title}",
    body:
      '<p>Hi {first_name},</p><p>"{talk_title}" is scheduled for {session_time} in {room_name}. A calendar invite is attached.</p><p>{portal_url}</p>',
  },
};

export async function getTemplate(eventId: number, key: string): Promise<TemplateBody> {
  const db = getDb();
  const row = await db
    .select({ key: emailTemplates.key, name: emailTemplates.name, subject: emailTemplates.subject, bodyHtml: emailTemplates.bodyHtml })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.eventId, eventId), eq(emailTemplates.key, key)))
    .get();
  if (row) return { key: row.key, name: row.name, subject: row.subject, body: row.bodyHtml };
  return BUILT_IN[key] ?? { key, name: key, subject: "", body: "" };
}

export async function listTemplates(eventId: number): Promise<TemplateBody[]> {
  const db = getDb();
  const rows = await db
    .select({ key: emailTemplates.key, name: emailTemplates.name, subject: emailTemplates.subject, bodyHtml: emailTemplates.bodyHtml })
    .from(emailTemplates)
    .where(eq(emailTemplates.eventId, eventId))
    .all();
  const stored = rows.map((row) => ({ key: row.key, name: row.name, subject: row.subject, body: row.bodyHtml }));
  const storedKeys = new Set(stored.map((row) => row.key));
  return [...stored, ...Object.values(BUILT_IN).filter((row) => !storedKeys.has(row.key))];
}

export interface MergeSubject {
  name: string;
  firstName: string;
  email: string;
  contactId: number;
}

export function mergeVars(
  event: { id: number; name: string },
  person: MergeSubject,
  extras: Record<string, string> = {}
): Record<string, string> {
  return {
    speaker_name: person.name,
    first_name: person.firstName || person.name,
    event_name: event.name,
    portal_url: `${appBaseUrl()}/portal`,
    talk_title: "",
    task_list: "",
    ...extras,
  };
}

export interface BulkRecipient {
  person: MergeSubject;
  extras?: Record<string, string>;
  ics?: IcsAttachment;
}

/** Records every send now and hands delivery to the cron runner. Returns the count
 *  so the UI can state exactly how many messages were queued. */
export async function queueBulk(input: {
  event: { id: number; name: string };
  templateKey: string;
  subject: string;
  body: string;
  recipients: BulkRecipient[];
}): Promise<number> {
  let queued = 0;
  for (const recipient of input.recipients) {
    const vars = mergeVars(input.event, recipient.person, recipient.extras);
    await queueEmail(bindings, {
      eventId: input.event.id,
      templateKey: input.templateKey,
      toEmail: recipient.person.email,
      toContactId: recipient.person.contactId,
      toName: recipient.person.name,
      subject: renderTemplate(input.subject, vars),
      bodyHtml: renderTemplate(input.body, vars),
      ics: recipient.ics,
    });
    queued += 1;
  }
  return queued;
}

export async function recentSends(eventId: number, limit = 200) {
  const db = getDb();
  return db
    .select({
      id: emailSends.id,
      templateKey: emailSends.templateKey,
      toEmail: emailSends.toEmail,
      toContactId: emailSends.toContactId,
      subject: emailSends.subject,
      bodyHtml: emailSends.bodyHtml,
      status: emailSends.status,
      icsAttached: emailSends.icsAttached,
      createdAt: emailSends.createdAt,
      sentAt: emailSends.sentAt,
      error: emailSends.error,
    })
    .from(emailSends)
    .where(eq(emailSends.eventId, eventId))
    .orderBy(desc(emailSends.createdAt), desc(emailSends.id))
    .limit(limit)
    .all();
}
