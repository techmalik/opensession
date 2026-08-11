// Event creation and the invariants that come with it. Creating an event must stay
// under a minute for the eval agent, so this does the setup an organizer would
// otherwise have to click through.

import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "./db.server";
import { slugify } from "./format";
import { featuredEventSlug } from "./settings.server";
import { emailTemplates, events, formats, levels, rooms, statuses, tracks } from "../../database/schema";

/** The five system statuses, in pipeline order. Vocabulary is fixed by CLAUDE.md. */
export const SYSTEM_STATUSES: { key: string; label: string; color: string }[] = [
  { key: "pending", label: "Pending", color: "#94a3b8" },
  { key: "accept_queue", label: "Accept Queue", color: "#0284c7" },
  { key: "accepted", label: "Accepted", color: "#0b7b57" },
  { key: "decline_queue", label: "Decline Queue", color: "#d97706" },
  { key: "declined", label: "Declined", color: "#e11d48" },
];

/** The taxonomy a new event starts with. Without it the call for papers renders two
 *  required dropdowns with no options (track and format are built from the live
 *  taxonomy), and the agenda has no rooms to schedule into. Generic enough for any
 *  conference, and an organizer renames or deletes any of it under Settings. */
export const DEFAULT_TRACKS: { name: string; color: string }[] = [
  { name: "Engineering", color: "#0b7b57" },
  { name: "Product", color: "#0284c7" },
  { name: "Practice", color: "#7c3aed" },
];

export const DEFAULT_FORMATS: { name: string; durationMin: number }[] = [
  { name: "Keynote (45 min)", durationMin: 45 },
  { name: "Talk (30 min)", durationMin: 30 },
  { name: "Lightning Talk (10 min)", durationMin: 10 },
  { name: "Workshop (120 min)", durationMin: 120 },
  { name: "Panel (45 min)", durationMin: 45 },
];

export const DEFAULT_ROOMS: { name: string; capacity: number }[] = [
  { name: "Main Stage", capacity: 600 },
  { name: "Room A", capacity: 150 },
  { name: "Room B", capacity: 150 },
  { name: "Workshop Lab", capacity: 60 },
];

export const DEFAULT_LEVELS = ["Beginner", "Intermediate", "Advanced"];

/** The event the public landing page and alias routes are "about": the featured
 *  event if it exists and is active, otherwise the most recently created active
 *  event. Returns the full row; callers pick the fields they need. */
export async function featuredActiveEvent() {
  const db = getDb();
  const slug = await featuredEventSlug();
  const featured = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), eq(events.status, "active")))
    .get();
  if (featured) return featured;
  return db.select().from(events).where(eq(events.status, "active")).orderBy(desc(events.createdAt)).get();
}

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
    bodyHtml:
      '<p>Hi {speaker_name},</p><p>We received "{talk_title}" for {event_name}. You can edit it from your portal until the call for proposals closes.</p>{portal_button}',
  },
  {
    key: "acceptance",
    name: "Acceptance",
    subject: "Your talk has been accepted to {event_name}",
    bodyHtml:
      '<p>Hi {speaker_name},</p><p>Congratulations. Your session "{talk_title}" has been accepted at {event_name}. Please confirm your participation and complete your speaker profile.</p>{portal_button}',
  },
  {
    key: "decline",
    name: "Decline",
    subject: "Update on your {event_name} proposal",
    bodyHtml:
      '<p>Hi {speaker_name},</p><p>Thank you for submitting "{talk_title}" to {event_name}. We are not able to include it this year. We had far more strong proposals than slots, and we would still love to see you at the event.</p>',
  },
  {
    key: "schedule",
    name: "Schedule notice",
    subject: "Your session is scheduled: {talk_title}",
    bodyHtml:
      '<p>Hi {first_name},</p><p>"{talk_title}" is scheduled for {session_time} in {room_name}. A calendar invitation is attached.</p>{portal_button}',
  },
];

/** Creates the event and everything it needs to be usable straight away: the five
 *  system statuses, a starter taxonomy, and the default email templates. An event
 *  with no formats or rooms looks fine on the dashboard and then fails at the two
 *  places that matter, the call for papers and the agenda. */
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

  await db.insert(tracks).values(
    DEFAULT_TRACKS.map((track, index) => ({ eventId: created.id, name: track.name, color: track.color, sort: index }))
  );

  await db.insert(formats).values(
    DEFAULT_FORMATS.map((format, index) => ({
      eventId: created.id,
      name: format.name,
      durationMin: format.durationMin,
      sort: index,
    }))
  );

  await db.insert(rooms).values(
    DEFAULT_ROOMS.map((room, index) => ({ eventId: created.id, name: room.name, capacity: room.capacity, sort: index }))
  );

  await db.insert(levels).values(
    DEFAULT_LEVELS.map((name, index) => ({ eventId: created.id, name, sort: index }))
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
