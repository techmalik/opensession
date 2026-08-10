// Everything the public surfaces read: the five embed widgets, the public agenda
// page, the JSON feeds, and the iCal feed. One gate, one query, one shape, so a
// session can never leak into one surface while being hidden on another.
//
// A session is public only when all of these hold:
//   - its event is active
//   - it is not a draft
//   - its status is "accepted"
//   - it has a room, a start, and an end (it is scheduled)
//   - its public_state is "published" (CNT-12: the organizer's content gate)
//
// Everything is formatted here, in the event timezone, so the widget components
// stay presentational and no date math ships to the browser.

import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import { eventDays, formatDayLabel, formatTimeOfDay, toZonedDateValue, zonedParts } from "./format";
import type { PublicEvent, PublicSession, PublicSpeaker, PublicSpeakerProfile } from "./embed-view";
import {
  contacts,
  events,
  formats,
  rooms,
  sessionParticipants,
  sessionTags,
  sessions,
  statuses,
  tags,
  tracks,
} from "../../database/schema";

export type {
  PublicEvent,
  PublicSpeaker,
  PublicSession,
  PublicSpeakerProfile,
} from "./embed-view";

export interface PublicData {
  event: PublicEvent;
  sessions: PublicSession[];
  speakers: PublicSpeakerProfile[];
  days: { value: string; label: string }[];
  rooms: { id: number; name: string }[];
  tracks: string[];
  formats: string[];
}

const PUBLIC_ROLES = new Set(["speaker", "co_speaker", "panelist", "moderator", "chairperson"]);

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

/** Public 404 for anything that is not a live event. Deliberately identical for a
 *  missing slug and an archived event: no information either way. */
export async function requirePublicEvent(slug: string): Promise<PublicEvent> {
  const db = getDb();
  const row = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      tagline: events.tagline,
      description: events.description,
      location: events.location,
      timezone: events.timezone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      status: events.status,
      agendaPublishedAt: events.agendaPublishedAt,
    })
    .from(events)
    .where(eq(events.slug, slug))
    .get();
  if (!row || row.status === "archived") throw new Response("Not found", { status: 404 });

  const { formatDateRange } = await import("./format");
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    tagline: row.tagline,
    description: row.description,
    location: row.location,
    timezone: row.timezone,
    dateRange: formatDateRange(row.startsAt, row.endsAt, row.timezone),
    agendaPublished: row.agendaPublishedAt != null,
  };
}

export async function loadPublicData(slug: string): Promise<PublicData> {
  const db = getDb();
  const event = await requirePublicEvent(slug);

  const eventRow = await db
    .select({ startsAt: events.startsAt, endsAt: events.endsAt })
    .from(events)
    .where(eq(events.id, event.id))
    .get();

  const rows = await db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      abstract: sessions.abstract,
      roomId: sessions.roomId,
      roomName: rooms.name,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      trackName: tracks.name,
      trackColor: tracks.color,
      formatName: formats.name,
      statusKey: statuses.key,
    })
    .from(sessions)
    .leftJoin(rooms, eq(sessions.roomId, rooms.id))
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .leftJoin(formats, eq(sessions.formatId, formats.id))
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(
      and(
        eq(sessions.eventId, event.id),
        eq(sessions.isDraft, false),
        eq(sessions.publicState, "published")
      )
    )
    .orderBy(asc(sessions.startsAt), asc(sessions.id))
    .all();

  const live = rows.filter(
    (row) => row.statusKey === "accepted" && row.startsAt != null && row.endsAt != null && row.roomId != null
  );
  const ids = live.map((row) => row.id);

  const participantRows =
    ids.length > 0
      ? await db
          .select({
            sessionId: sessionParticipants.sessionId,
            contactId: sessionParticipants.contactId,
            role: sessionParticipants.role,
            sort: sessionParticipants.sort,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            title: contacts.title,
            company: contacts.company,
            bio: contacts.bio,
            headshotBlobKey: contacts.headshotBlobKey,
          })
          .from(sessionParticipants)
          .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
          .where(inArray(sessionParticipants.sessionId, ids))
          .all()
      : [];

  const tagRows =
    ids.length > 0
      ? await db
          .select({ sessionId: sessionTags.sessionId, name: tags.name })
          .from(sessionTags)
          .leftJoin(tags, eq(sessionTags.tagId, tags.id))
          .where(inArray(sessionTags.sessionId, ids))
          .all()
      : [];

  const speakersBySession = new Map<number, PublicSpeaker[]>();
  for (const row of participantRows.sort((a, b) => a.sort - b.sort)) {
    if (!PUBLIC_ROLES.has(row.role)) continue;
    const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.email || "Speaker";
    const speaker: PublicSpeaker = {
      contactId: row.contactId,
      name,
      sortKey: `${(row.lastName ?? "").toLowerCase()} ${(row.firstName ?? "").toLowerCase()}`.trim() || name.toLowerCase(),
      title: row.title,
      company: row.company,
      bio: row.bio,
      initials: initialsOf(name),
      headshotUrl: row.headshotBlobKey ? `/embed/v1/${event.slug}/headshot/${row.contactId}` : null,
      role: row.role,
    };
    speakersBySession.set(row.sessionId, [...(speakersBySession.get(row.sessionId) ?? []), speaker]);
  }

  const tagsBySession = new Map<number, string[]>();
  for (const row of tagRows) {
    if (!row.name) continue;
    tagsBySession.set(row.sessionId, [...(tagsBySession.get(row.sessionId) ?? []), row.name]);
  }

  const zone = event.timezone;
  const sessionList: PublicSession[] = live.map((row) => {
    const startsAt = row.startsAt as Date;
    const endsAt = row.endsAt as Date;
    const day = toZonedDateValue(startsAt, zone);
    const parts = zonedParts(startsAt, zone);
    const startLabel = formatTimeOfDay(startsAt, zone);
    const endLabel = formatTimeOfDay(endsAt, zone);
    const longDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone }).format(
      startsAt
    );
    return {
      id: row.id,
      friendlyId: row.friendlyId,
      title: row.title,
      abstract: row.abstract ?? "",
      trackName: row.trackName,
      trackColor: row.trackColor,
      formatName: row.formatName,
      roomId: row.roomId,
      roomName: row.roomName,
      day,
      dayLabel: formatDayLabel(day, zone),
      startLabel,
      endLabel,
      whenLabel: `${longDay}: ${startLabel} - ${endLabel}`,
      startIso: startsAt.toISOString(),
      endIso: endsAt.toISOString(),
      startMinutes: parts.hour * 60 + parts.minute,
      durationMin: Math.max(5, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000)),
      speakers: speakersBySession.get(row.id) ?? [],
      tags: tagsBySession.get(row.id) ?? [],
    };
  });

  // Speaker directory: one entry per person, their sessions in time order.
  const byContact = new Map<number, PublicSpeakerProfile>();
  for (const session of sessionList) {
    for (const speaker of session.speakers) {
      const existing = byContact.get(speaker.contactId);
      if (existing) existing.sessions.push(session);
      else byContact.set(speaker.contactId, { ...speaker, sessions: [session] });
    }
  }
  const speakerList = [...byContact.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  for (const speaker of speakerList) speaker.sessions.sort((a, b) => a.startIso.localeCompare(b.startIso));

  // Event days first, then any day a session actually landed on, so a session
  // scheduled outside the declared dates is still reachable in the widgets.
  const declared = eventDays(eventRow?.startsAt ?? null, eventRow?.endsAt ?? null, zone);
  const used = [...new Set(sessionList.map((session) => session.day))];
  const dayValues = [...new Set([...declared, ...used])].sort().filter((day) => used.includes(day) || declared.includes(day));

  const roomRows = await db
    .select({ id: rooms.id, name: rooms.name })
    .from(rooms)
    .where(eq(rooms.eventId, event.id))
    .orderBy(asc(rooms.sort), asc(rooms.id))
    .all();

  return {
    event,
    sessions: sessionList,
    speakers: speakerList,
    days: dayValues.map((value) => ({ value, label: formatDayLabel(value, zone) })),
    rooms: roomRows.filter((room) => sessionList.some((session) => session.roomId === room.id)),
    tracks: [...new Set(sessionList.map((session) => session.trackName).filter((name): name is string => Boolean(name)))].sort(),
    formats: [...new Set(sessionList.map((session) => session.formatName).filter((name): name is string => Boolean(name)))].sort(),
  };
}

export interface PublicFilters {
  q: string;
  track: string;
  format: string;
  room: string;
  day: string;
}

export function readFilters(url: URL): PublicFilters {
  return {
    q: (url.searchParams.get("q") ?? "").trim(),
    track: url.searchParams.get("track") ?? "",
    format: url.searchParams.get("format") ?? "",
    room: url.searchParams.get("room") ?? "",
    day: url.searchParams.get("day") ?? "",
  };
}

/** Session search matches titles, abstracts, and speaker names, which is what the
 *  sessions list and itinerary widgets document. */
export function filterSessions(list: PublicSession[], filters: PublicFilters): PublicSession[] {
  const q = filters.q.toLowerCase();
  return list.filter((session) => {
    if (filters.track && session.trackName !== filters.track) return false;
    if (filters.format && session.formatName !== filters.format) return false;
    if (filters.room && session.roomName !== filters.room) return false;
    if (filters.day && session.day !== filters.day) return false;
    if (!q) return true;
    return (
      session.title.toLowerCase().includes(q) ||
      session.abstract.toLowerCase().includes(q) ||
      session.speakers.some((speaker) => speaker.name.toLowerCase().includes(q))
    );
  });
}

/** Speaker widgets match on the person, not their sessions. */
export function filterSpeakers(list: PublicSpeakerProfile[], q: string): PublicSpeakerProfile[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return list;
  return list.filter(
    (speaker) =>
      speaker.name.toLowerCase().includes(needle) ||
      (speaker.company ?? "").toLowerCase().includes(needle) ||
      (speaker.title ?? "").toLowerCase().includes(needle)
  );
}

export function groupByDay(list: PublicSession[], days: { value: string; label: string }[]) {
  return days
    .map((day) => ({
      ...day,
      sessions: list.filter((session) => session.day === day.value).sort((a, b) => a.startIso.localeCompare(b.startIso)),
    }))
    .filter((group) => group.sessions.length > 0);
}

/** Cache policy for every public widget response.
 *
 *  Embedded URLs carry ?v=<embed_cache_version>, so the version is part of the cache
 *  key: bumping it with "Refresh embeds" changes every snippet URL and misses both
 *  the edge cache and the browser cache. Those versioned URLs get the full hour.
 *
 *  A visitor browsing the widget directly (no ?v) gets a short cache instead. An
 *  hour-long cache on the canonical URL would make an organizer's edit look lost for
 *  an hour, which is worse than the extra origin hits. */
export function publicCacheHeaders(url: URL, extra: Record<string, string> = {}): Headers {
  const versioned = url.searchParams.has("v");
  const maxAge = versioned ? 3600 : 60;
  return new Headers({
    "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}`,
    ...extra,
  });
}
