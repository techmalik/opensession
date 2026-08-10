// Event creation and the invariants that come with it. Creating an event must stay
// under a minute for the eval agent, so this does the setup an organizer would
// otherwise have to click through.

import { and, eq, ne } from "drizzle-orm";
import { getDb } from "./db.server";
import { slugify } from "./format";
import { emailTemplates, events, statuses } from "../../database/schema";

/** The five system statuses, in pipeline order. Vocabulary is fixed by CLAUDE.md. */
export const SYSTEM_STATUSES: { key: string; label: string; color: string }[] = [
  { key: "pending", label: "Pending", color: "#94a3b8" },
  { key: "accept_queue", label: "Accept Queue", color: "#0284c7" },
  { key: "accepted", label: "Accepted", color: "#0d9166" },
  { key: "decline_queue", label: "Decline Queue", color: "#d97706" },
  { key: "declined", label: "Declined", color: "#e11d48" },
];

/** Appends -2, -3, ... until the slug is free. Excludes `exceptEventId` when editing. */
export async function uniqueSlug(name: string, exceptEventId?: number): Promise<string> {
  const db = getDb();
  const base = slugify(name) || "event";
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db
      .select({ id: events.id })
      .from(events)
      .where(exceptEventId ? and(eq(events.slug, candidate), ne(events.id, exceptEventId)) : eq(events.slug, candidate))
      .get();
    if (!clash) return candidate;
  }
}

export interface NewEventInput {
  name: string;
  description: string | null;
  location: string | null;
  timezone: string;
  startsAt: Date | null;
  endsAt: Date | null;
  createdBy: number;
}

/** The default email templates every event starts with. Merge tags:
 *  {speaker_name}, {talk_title}, {event_name}, {status}, {portal_url}. */
const DEFAULT_TEMPLATES: { key: string; name: string; subject: string; bodyHtml: string }[] = [
  {
    key: "confirmation",
    name: "Submission confirmation",
    subject: "We received your proposal for {event_name}",
    bodyHtml: '<p>Hi {speaker_name},</p><p>We received "{talk_title}". You can edit it from your portal until the form closes.</p><p>{portal_url}</p>',
  },
  {
    key: "acceptance",
    name: "Acceptance",
    subject: "Your talk has been accepted to {event_name}",
    bodyHtml:
      '<p>Hi {speaker_name},</p><p>Congratulations. Your session "{talk_title}" has been accepted. Please confirm your participation and complete your speaker profile.</p><p>{portal_url}</p>',
  },
  {
    key: "decline",
    name: "Decline",
    subject: "Update on your {event_name} proposal",
    bodyHtml:
      '<p>Hi {speaker_name},</p><p>Thank you for submitting "{talk_title}". We are not able to include it this year. We would love to see you at the event.</p>',
  },
  {
    key: "schedule",
    name: "Schedule notice",
    subject: "Your session is scheduled: {talk_title}",
    bodyHtml: '<p>Hi {speaker_name},</p><p>"{talk_title}" is scheduled. A calendar invite is attached.</p>',
  },
];

/** Creates the event, its five system statuses, and the default email templates.
 *  Tracks, formats, and rooms start empty and are managed under Settings. */
export async function createEvent(input: NewEventInput): Promise<number> {
  const db = getDb();
  const now = new Date();
  const slug = await uniqueSlug(input.name);

  const created = await db
    .insert(events)
    .values({
      name: input.name,
      slug,
      description: input.description,
      location: input.location,
      timezone: input.timezone,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "active",
      createdBy: input.createdBy,
      createdAt: now,
    })
    .returning({ id: events.id })
    .get();

  await db.insert(statuses).values(
    SYSTEM_STATUSES.map((status, index) => ({
      eventId: created.id,
      key: status.key,
      label: status.label,
      color: status.color,
      isSystem: true,
      sort: index,
    }))
  );

  await db.insert(emailTemplates).values(
    DEFAULT_TEMPLATES.map((template) => ({
      eventId: created.id,
      key: template.key,
      name: template.name,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      createdAt: now,
    }))
  );

  return created.id;
}
