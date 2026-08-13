// Templates, merge variables, and bulk queueing. Every organizer-facing send goes
// through here so the Communications log and the merge-tag vocabulary stay identical
// wherever the send was triggered from.

import { and, desc, eq } from "drizzle-orm";
import { appBaseUrl, bindings, getDb } from "./db.server";
import { queueEmail, renderTemplate, renderTemplateHtml, type IcsAttachment } from "./email";
import { emailButton } from "./email-layout";
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
  acceptance: {
    key: "acceptance",
    name: "Acceptance",
    subject: "Your talk has been accepted to {event_name}",
    body:
      '<p>Hi {speaker_name},</p><p>Congratulations. Your session "{talk_title}" has been accepted at {event_name}. Please confirm your participation and complete your speaker profile.</p>{portal_button}',
  },
  decline: {
    key: "decline",
    name: "Decline",
    subject: "Update on your {event_name} proposal",
    body:
      '<p>Hi {speaker_name},</p><p>Thank you for submitting "{talk_title}". We are not able to include it this year. We would love to see you at the event.</p>{#feedback}<p>{feedback}</p>{/feedback}',
  },
  cfp_reminder: {
    key: "cfp_reminder",
    name: "CFP close reminder",
    subject: "{event_name}: {form_name} closes {close_date}",
    body:
      "<p>Hi {first_name},</p><p>{form_name} for {event_name} closes on {close_date}.</p><p>{reason}</p>{portal_button}",
  },
  weekly_digest: {
    key: "weekly_digest",
    name: "Weekly speaker digest",
    subject: "{event_name}: what is still outstanding",
    body: "<p>Hi {first_name},</p><p>This is your weekly summary for {event_name}.</p>{task_list}{portal_button}",
  },
  task_reminder: {
    key: "task_reminder",
    name: "Task deadline reminder",
    subject: "{event_name}: deadlines coming up",
    body:
      "<p>Hi {first_name},</p><p>These {event_name} items are due:</p>{task_list}" +
      "<p>You can complete them from your speaker portal.</p>{portal_button}",
  },
  portal_invite: {
    key: "portal_invite",
    name: "Speaker portal invite",
    subject: "Your speaker portal for {event_name}",
    body:
      "<p>Hi {first_name},</p><p>Your speaker portal for {event_name} is open. Complete your profile, confirm your sessions, and work through your task list there.</p>{portal_button}",
  },
  speaker_welcome: {
    key: "speaker_welcome",
    name: "Speaker welcome",
    subject: "Welcome to {event_name} speakers",
    body:
      "<p>Hi {first_name},</p><p>Welcome to {event_name}. Everything you need is in your speaker portal: your sessions, your profile, and your task list.</p>{portal_button}",
  },
  deliverables_reminder: {
    key: "deliverables_reminder",
    name: "Deliverables reminder",
    subject: "Still outstanding for {event_name}",
    body:
      "<p>Hi {first_name},</p><p>These are still outstanding for {event_name}:</p>{task_list}<p>You can upload them from your portal.</p>{portal_button}",
  },
  schedule: {
    key: "schedule",
    name: "Schedule notice",
    subject: "Your session is scheduled: {talk_title}",
    body:
      '<p>Hi {first_name},</p><p>"{talk_title}" is scheduled for {session_time} in {room_name}. A calendar invitation is attached.</p>{portal_button}',
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
  const portalUrl = `${appBaseUrl()}/portal`;
  return {
    speaker_name: person.name,
    first_name: person.firstName || person.name,
    event_name: event.name,
    portal_url: portalUrl,
    // The same link as a real button. Templates use this instead of pasting a URL
    // into a paragraph, which is what made every email look like a plain-text note.
    portal_button: emailButton(portalUrl, "Open your speaker portal"),
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
      bodyHtml: renderTemplateHtml(input.body, vars),
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

/** Upserts an event's copy of a template. Editing a built-in creates the row the
 *  first time it is saved; every send path reads getTemplate, so the edit applies
 *  everywhere that key is used. */
export async function saveTemplate(eventId: number, input: TemplateBody): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: emailTemplates.id })
    .from(emailTemplates)
    .where(and(eq(emailTemplates.eventId, eventId), eq(emailTemplates.key, input.key)))
    .get();

  if (existing) {
    await db
      .update(emailTemplates)
      .set({ name: input.name, subject: input.subject, bodyHtml: input.body })
      .where(eq(emailTemplates.id, existing.id));
    return;
  }
  await db.insert(emailTemplates).values({
    eventId,
    key: input.key,
    name: input.name,
    subject: input.subject,
    bodyHtml: input.body,
    createdAt: new Date(),
  });
}

/** Drops the event's override so the built-in copy applies again. */
export async function resetTemplate(eventId: number, key: string): Promise<void> {
  const db = getDb();
  await db.delete(emailTemplates).where(and(eq(emailTemplates.eventId, eventId), eq(emailTemplates.key, key)));
}

export const MERGE_TAGS: { tag: string; meaning: string }[] = [
  { tag: "{speaker_name}", meaning: "Full name of the recipient" },
  { tag: "{first_name}", meaning: "First name, falls back to the full name" },
  { tag: "{event_name}", meaning: "This event's name" },
  { tag: "{talk_title}", meaning: "Session title, where the send is about one session" },
  { tag: "{portal_url}", meaning: "Plain link to the speaker portal" },
  { tag: "{portal_button}", meaning: "The portal link as a styled button" },
  { tag: "{task_list}", meaning: "Outstanding tasks and files, as an HTML list" },
  { tag: "{feedback}", meaning: "Decline feedback for this speaker; the tag and its paragraph disappear when left blank. Decline emails only." },
  { tag: "{session_time}", meaning: "Scheduled start, schedule notices only" },
  { tag: "{room_name}", meaning: "Room, schedule notices only" },
  { tag: "{form_name}", meaning: "Form name, CFP reminders only" },
  { tag: "{close_date}", meaning: "Form close date, CFP reminders only" },
  { tag: "{reason}", meaning: "Why this reminder was sent, CFP reminders only" },
];
