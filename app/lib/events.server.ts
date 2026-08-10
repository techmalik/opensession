// Event creation and the invariants that come with it. Creating an event must stay
// under a minute for the eval agent, so this does the setup an organizer would
// otherwise have to click through.

import { and, eq, ne } from "drizzle-orm";
import { getDb } from "./db.server";
import { slugify } from "./format";
import { events, statuses } from "../../database/schema";

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

/** Creates the event and its five system statuses. Tracks, formats, and rooms start
 *  empty and are managed under Settings. */
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

  return created.id;
}
