// Scheduled mail: CFP close reminders, deadline reminders for portal tasks and file
// requests, and the weekly speaker digest. All three are driven by the jobs table,
// all three are safe to run twice, and all three write to email_sends first so
// Communications shows the evidence whether or not a provider key is set.
//
// Scheduling and sending are separate on purpose. ensureScheduledJobs() only creates
// job rows (idempotently, keyed on the payload), and the job runner calls the send
// functions below. An organizer can also call the send functions directly from
// Communications to prove the flow without waiting for a cron tick.

import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import { getTemplate, mergeVars, queueBulk } from "./comms.server";
import { loadAudiences, resolveAudience } from "./tasks.server";
import { escapeHtml } from "./email";
import { formatDate } from "./format";
import type { Audience } from "./labels";
import {
  contacts,
  eventContacts,
  events,
  fileRequests,
  fileUploads,
  forms,
  jobs,
  portalTasks,
  sessionParticipants,
  sessions,
  taskCompletions,
  taskReminders,
} from "../../database/schema";

const DAY_MS = 86_400_000;

/** ISO-ish week key, used to keep the weekly digest to one send per event. */
export function weekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** UTC hour key, so "one sweep per event per hour" needs no extra bookkeeping. */
export function hourBucket(date: Date): string {
  return date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function parseDays(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  } catch {
    return [];
  }
}

/** Creates a job only if one with the same kind and payload does not exist yet, in
 *  any state. Re-running the sweep every five minutes must not pile up work. */
async function ensureJob(
  kind: "reminder" | "digest" | "task_reminder",
  payload: Record<string, unknown>,
  runAfter: Date
): Promise<boolean> {
  const db = getDb();
  const payloadJson = JSON.stringify(payload);
  const existing = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, kind), eq(jobs.payloadJson, payloadJson)))
    .get();
  if (existing) return false;
  await db.insert(jobs).values({ kind, payloadJson, runAfter, createdAt: new Date() });
  return true;
}

/** Called at the top of every job run. Turns form reminder settings and the weekly
 *  digest cadence into concrete, dated job rows. */
export async function ensureScheduledJobs(
  now = new Date()
): Promise<{ reminders: number; digests: number; taskReminders: number }> {
  const db = getDb();
  let reminders = 0;
  let digests = 0;
  let taskReminders = 0;

  const openForms = await db
    .select({ id: forms.id, closesAt: forms.closesAt, reminderDaysJson: forms.reminderDaysJson, status: forms.status })
    .from(forms)
    .where(eq(forms.status, "published"))
    .all();

  for (const form of openForms) {
    if (!form.closesAt || form.closesAt.getTime() <= now.getTime()) continue;
    for (const days of parseDays(form.reminderDaysJson)) {
      const runAfter = new Date(form.closesAt.getTime() - days * DAY_MS);
      // A reminder whose moment has already passed is not worth sending late.
      if (runAfter.getTime() < now.getTime() - DAY_MS) continue;
      if (await ensureJob("reminder", { formId: form.id, days }, runAfter)) reminders += 1;
    }
  }

  const activeEvents = await db.select({ id: events.id }).from(events).where(eq(events.status, "active")).all();
  for (const event of activeEvents) {
    if (await ensureJob("digest", { eventId: event.id, week: weekKey(now) }, now)) digests += 1;
    // Hourly, not daily: a deadline reminder that waits until tomorrow to notice an
    // overdue task is not a reminder. Sending stays bounded by the per-item
    // once-a-day rule in taskReminderTargets, not by how often we look.
    if (await ensureJob("task_reminder", { eventId: event.id, hour: hourBucket(now) }, now)) taskReminders += 1;
  }

  return { reminders, digests, taskReminders };
}

export interface ReminderRecipient {
  contactId: number;
  name: string;
  firstName: string;
  email: string;
  reason: string;
}

/** Who still has something to finish on this form: a saved draft, or a submitted
 *  proposal with an incomplete speaker profile. */
export async function reminderRecipients(formId: number): Promise<ReminderRecipient[]> {
  const db = getDb();
  const rows = await db
    .select({
      contactId: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      bio: contacts.bio,
      headshotBlobKey: contacts.headshotBlobKey,
      isDraft: sessions.isDraft,
      title: sessions.title,
    })
    .from(sessions)
    .innerJoin(contacts, eq(sessions.submittedBy, contacts.id))
    .where(eq(sessions.formId, formId))
    .all();

  const byContact = new Map<number, ReminderRecipient>();
  for (const row of rows) {
    const incompleteProfile = !row.bio?.trim() || !row.headshotBlobKey;
    if (!row.isDraft && !incompleteProfile) continue;
    const reason = row.isDraft
      ? `Your draft "${row.title}" has not been submitted yet.`
      : "Your speaker profile is missing a bio or a headshot.";
    // A draft is the more urgent of the two, so it wins if both apply.
    const existing = byContact.get(row.contactId);
    if (existing && !row.isDraft) continue;
    byContact.set(row.contactId, {
      contactId: row.contactId,
      name: `${row.firstName} ${row.lastName}`.trim() || row.email,
      firstName: row.firstName || row.email,
      email: row.email,
      reason,
    });
  }
  return [...byContact.values()];
}

const REMINDER_TEMPLATE = {
  subject: "{event_name}: {form_name} closes {close_date}",
  body:
    "<p>Hi {first_name},</p><p>{form_name} for {event_name} closes on {close_date}.</p><p>{reason}</p>" +
    "<p>You can finish it here: {portal_url}</p>",
};

/** Queues one reminder per person with unfinished work on the form. Returns how many
 *  were queued, so both the cron and the organizer button can report a number. */
export async function sendFormReminders(formId: number, daysBefore: number): Promise<number> {
  const db = getDb();
  const form = await db
    .select({ id: forms.id, name: forms.name, eventId: forms.eventId, closesAt: forms.closesAt, status: forms.status })
    .from(forms)
    .where(eq(forms.id, formId))
    .get();
  if (!form || form.status !== "published") return 0;

  const event = await db.select({ id: events.id, name: events.name, timezone: events.timezone }).from(events).where(eq(events.id, form.eventId)).get();
  if (!event) return 0;

  const people = await reminderRecipients(formId);
  if (people.length === 0) return 0;

  const stored = await getTemplate(form.eventId, "cfp_reminder");
  const subject = stored.subject || REMINDER_TEMPLATE.subject;
  const body = stored.body || REMINDER_TEMPLATE.body;
  const closeDate = formatDate(form.closesAt, event.timezone);

  return queueBulk({
    event: { id: event.id, name: event.name },
    templateKey: "cfp_reminder",
    subject,
    body,
    recipients: people.map((person) => ({
      person,
      extras: {
        form_name: form.name,
        close_date: closeDate || "soon",
        days_left: String(daysBefore),
        reason: person.reason,
      },
    })),
  });
}

export interface DigestItem {
  contactId: number;
  name: string;
  firstName: string;
  email: string;
  tasks: string[];
  files: string[];
}

/** Speakers who opted in and still owe something: an incomplete task or a file
 *  request with no approved upload. People with a clean slate get no mail. */
export async function digestRecipients(eventId: number): Promise<DigestItem[]> {
  const db = getDb();
  const resolver = await loadAudiences(eventId);

  const optIn = await db
    .select({ contactId: eventContacts.contactId, digestOptIn: eventContacts.digestOptIn })
    .from(eventContacts)
    .where(and(eq(eventContacts.eventId, eventId), eq(eventContacts.kind, "speaker")))
    .all();
  const allowed = new Set(optIn.filter((row) => row.digestOptIn).map((row) => row.contactId));
  if (allowed.size === 0) return [];

  const taskRows = await db
    .select()
    .from(portalTasks)
    .where(eq(portalTasks.eventId, eventId))
    .orderBy(asc(portalTasks.sort), asc(portalTasks.id))
    .all();
  const requestRows = await db.select().from(fileRequests).where(eq(fileRequests.eventId, eventId)).all();

  const completions =
    taskRows.length > 0
      ? await db
          .select()
          .from(taskCompletions)
          .where(inArray(taskCompletions.taskId, taskRows.map((row) => row.id)))
          .all()
      : [];
  const uploads =
    requestRows.length > 0
      ? await db
          .select({ requestId: fileUploads.requestId, contactId: fileUploads.contactId })
          .from(fileUploads)
          .where(inArray(fileUploads.requestId, requestRows.map((row) => row.id)))
          .all()
      : [];

  const people = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .where(inArray(contacts.id, [...allowed]))
    .all();

  const result: DigestItem[] = [];
  for (const person of people) {
    const openTasks = taskRows
      .filter((task) =>
        resolveAudience(resolver, task.appliesTo as Audience, resolver.taskSelected.get(task.id)).includes(person.id)
      )
      .filter((task) => !completions.some((row) => row.taskId === task.id && row.contactId === person.id && row.status === "done"))
      .map((task) => task.title);

    const openFiles = requestRows
      .filter((request) =>
        resolveAudience(resolver, request.appliesTo as Audience, resolver.requestSelected.get(request.id)).includes(person.id)
      )
      .filter((request) => !uploads.some((row) => row.requestId === request.id && row.contactId === person.id))
      .map((request) => request.title);

    if (openTasks.length === 0 && openFiles.length === 0) continue;
    result.push({
      contactId: person.id,
      name: `${person.firstName} ${person.lastName}`.trim() || person.email,
      firstName: person.firstName || person.email,
      email: person.email,
      tasks: openTasks,
      files: openFiles,
    });
  }
  return result;
}

const DIGEST_TEMPLATE = {
  subject: "{event_name}: what is still outstanding",
  body: "<p>Hi {first_name},</p><p>This is your weekly summary for {event_name}.</p>{task_list}<p>{portal_url}</p>",
};

export async function sendSpeakerDigest(eventId: number): Promise<number> {
  const db = getDb();
  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) return 0;

  const people = await digestRecipients(eventId);
  if (people.length === 0) return 0;

  const stored = await getTemplate(eventId, "weekly_digest");
  const subject = stored.subject || DIGEST_TEMPLATE.subject;
  const body = stored.body || DIGEST_TEMPLATE.body;

  return queueBulk({
    event,
    templateKey: "weekly_digest",
    subject,
    body,
    recipients: people.map((person) => ({
      person,
      extras: {
        task_list: [
          person.tasks.length > 0
            ? `<p>Open tasks:</p><ul>${person.tasks.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>`
            : "",
          person.files.length > 0
            ? `<p>Files we are still waiting for:</p><ul>${person.files.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>`
            : "",
        ].join(""),
      },
    })),
  });
}

// ---------- Deadline reminders for portal tasks and file requests ----------

/** How far ahead a deadline counts as "coming up". */
const DUE_SOON_MS = 48 * 3_600_000;
/** How long a speaker is left alone about the same item once they have been told. */
const REMIND_EVERY_MS = 24 * 3_600_000;

export interface DueItem {
  kind: "task" | "file_request";
  refId: number;
  title: string;
  dueAt: Date;
  overdue: boolean;
}

export interface TaskReminderTarget {
  contactId: number;
  name: string;
  firstName: string;
  email: string;
  items: DueItem[];
}

/** Speakers with a portal task still open or a file request still unfulfilled whose
 *  deadline has passed or falls inside the next 48 hours. Items this speaker was
 *  already reminded about in the last 24 hours are dropped, so a five-minute cron
 *  mails each deadline at most once a day. */
export async function taskReminderTargets(eventId: number, now = new Date()): Promise<TaskReminderTarget[]> {
  const db = getDb();
  const horizon = new Date(now.getTime() + DUE_SOON_MS);
  const resolver = await loadAudiences(eventId);

  const taskRows = (await db.select().from(portalTasks).where(eq(portalTasks.eventId, eventId)).all()).filter(
    (row): row is typeof row & { dueAt: Date } => row.dueAt != null && row.dueAt.getTime() <= horizon.getTime()
  );
  const requestRows = (await db.select().from(fileRequests).where(eq(fileRequests.eventId, eventId)).all()).filter(
    (row): row is typeof row & { dueAt: Date } => row.dueAt != null && row.dueAt.getTime() <= horizon.getTime()
  );
  if (taskRows.length === 0 && requestRows.length === 0) return [];

  const completions =
    taskRows.length > 0
      ? await db
          .select()
          .from(taskCompletions)
          .where(inArray(taskCompletions.taskId, taskRows.map((row) => row.id)))
          .all()
      : [];
  const uploads =
    requestRows.length > 0
      ? await db
          .select({ requestId: fileUploads.requestId, contactId: fileUploads.contactId })
          .from(fileUploads)
          .where(inArray(fileUploads.requestId, requestRows.map((row) => row.id)))
          .all()
      : [];

  const sent = await db.select().from(taskReminders).where(eq(taskReminders.eventId, eventId)).all();
  const recentlyReminded = new Set(
    sent
      .filter((row) => now.getTime() - row.lastRemindedAt.getTime() < REMIND_EVERY_MS)
      .map((row) => `${row.contactId}:${row.kind}:${row.refId}`)
  );

  const owed = new Map<number, DueItem[]>();
  const add = (contactId: number, item: DueItem) => {
    if (recentlyReminded.has(`${contactId}:${item.kind}:${item.refId}`)) return;
    owed.set(contactId, [...(owed.get(contactId) ?? []), item]);
  };

  for (const task of taskRows) {
    const audience = resolveAudience(resolver, task.appliesTo as Audience, resolver.taskSelected.get(task.id));
    for (const contactId of audience) {
      const done = completions.some(
        (row) => row.taskId === task.id && row.contactId === contactId && row.status === "done"
      );
      if (done) continue;
      add(contactId, {
        kind: "task",
        refId: task.id,
        title: task.title,
        dueAt: task.dueAt,
        overdue: task.dueAt.getTime() < now.getTime(),
      });
    }
  }

  for (const request of requestRows) {
    const audience = resolveAudience(resolver, request.appliesTo as Audience, resolver.requestSelected.get(request.id));
    for (const contactId of audience) {
      if (uploads.some((row) => row.requestId === request.id && row.contactId === contactId)) continue;
      add(contactId, {
        kind: "file_request",
        refId: request.id,
        title: request.title,
        dueAt: request.dueAt,
        overdue: request.dueAt.getTime() < now.getTime(),
      });
    }
  }

  if (owed.size === 0) return [];

  const people = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .where(inArray(contacts.id, [...owed.keys()]))
    .all();

  return people
    .filter((person) => person.email)
    .map((person) => ({
      contactId: person.id,
      name: `${person.firstName} ${person.lastName}`.trim() || person.email,
      firstName: person.firstName || person.email,
      email: person.email,
      items: (owed.get(person.id) ?? []).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime()),
    }));
}

const TASK_REMINDER_TEMPLATE = {
  subject: "{event_name}: deadlines coming up",
  body:
    "<p>Hi {first_name},</p><p>These {event_name} items are due:</p>{task_list}" +
    "<p>You can complete them from your speaker portal.</p>{portal_button}",
};

/** Queues one reminder per speaker with something due, then records what each of them
 *  was told about so the next tick leaves those items alone for a day. */
export async function sendTaskReminders(eventId: number, now = new Date()): Promise<number> {
  const db = getDb();
  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) return 0;

  const targets = await taskReminderTargets(eventId, now);
  if (targets.length === 0) return 0;

  const stored = await getTemplate(eventId, "task_reminder");
  const subject = stored.subject || TASK_REMINDER_TEMPLATE.subject;
  const body = stored.body || TASK_REMINDER_TEMPLATE.body;

  // One recipient at a time, dedupe row first. Writing every email and then every
  // dedupe row leaves a window: an isolate that dies between the two, or an
  // overlapping cron tick, sends the whole batch again. Claiming first means the
  // worst case is one reminder skipped for a day, not one sent twice.
  let queued = 0;
  for (const target of targets) {
    for (const item of target.items) {
      await db
        .insert(taskReminders)
        .values({ eventId, contactId: target.contactId, kind: item.kind, refId: item.refId, lastRemindedAt: now })
        .onConflictDoUpdate({
          target: [taskReminders.contactId, taskReminders.kind, taskReminders.refId],
          set: { lastRemindedAt: now, eventId },
        });
    }

    queued += await queueBulk({
      event: { id: event.id, name: event.name },
      templateKey: "task_reminder",
      subject,
      body,
      recipients: [
        {
          person: target,
          extras: {
            task_list: `<ul>${target.items
              .map(
                (item) =>
                  `<li>${escapeHtml(item.title)}, ${item.overdue ? "was due" : "due"} ${escapeHtml(
                    formatDate(item.dueAt, event.timezone) || ""
                  )}${item.overdue ? " (overdue)" : ""}</li>`
              )
              .join("")}</ul>`,
            due_count: String(target.items.length),
          },
        },
      ],
    });
  }

  return queued;
}

/** Every session this contact is on, used by the digest preview in Communications. */
export async function speakerSessionCount(eventId: number, contactId: number): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: sessions.id })
    .from(sessionParticipants)
    .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
    .where(and(eq(sessions.eventId, eventId), eq(sessionParticipants.contactId, contactId)))
    .all();
  return rows.length;
}

export { mergeVars };
