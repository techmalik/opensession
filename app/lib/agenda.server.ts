// The agenda model: what is placed where, what clashes, and a deterministic packer.
// Conflicts are computed on the server every time the grid renders, so what the
// organizer sees is never a stale client guess.

import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import { eventDays, toZonedDateValue, toZonedTimeValue, zonedDayTimeToUtc, zonedParts } from "./format";
import {
  slotOffsets,
  slotTimeValue,
  AGENDA_END_HOUR,
  AGENDA_START_HOUR,
  DEFAULT_DURATION_MIN,
  SLOT_MINUTES,
} from "./agenda-grid";
import type { PublicState } from "./labels";
import {
  contacts,
  events,
  formats,
  rooms,
  sessionParticipants,
  sessions,
  statuses,
  tracks,
} from "../../database/schema";


export interface AgendaEvent {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  location: string | null;
  description: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  agendaPublishedAt: Date | null;
}

export interface AgendaSpeaker {
  contactId: number;
  name: string;
}

export interface AgendaSession {
  id: number;
  friendlyId: string;
  title: string;
  abstract: string | null;
  /** "held" keeps the session off every public surface. See app/lib/public.server.ts. */
  publicState: PublicState;
  roomId: number | null;
  roomName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  trackId: number | null;
  trackName: string | null;
  trackColor: string | null;
  formatName: string | null;
  durationMin: number;
  speakers: AgendaSpeaker[];
}

export interface AgendaRoom {
  id: number;
  name: string;
  capacity: number | null;
}

export type ConflictKind = "room" | "speaker" | "hours";

export interface Conflict {
  kind: ConflictKind;
  message: string;
  sessionIds: number[];
}

export interface AgendaData {
  event: AgendaEvent;
  rooms: AgendaRoom[];
  days: string[];
  scheduled: AgendaSession[];
  unscheduled: AgendaSession[];
  conflicts: Conflict[];
}

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

type Placed = AgendaSession & { startsAt: Date; endsAt: Date };

function placedOnly(list: AgendaSession[]): Placed[] {
  return list.filter((s): s is Placed => s.startsAt != null && s.endsAt != null);
}

/** Room double-booking, one speaker in two places, and anything outside the event
 *  days or the agenda window. Conflicting placements are allowed but reported. */
export function detectConflicts(scheduled: AgendaSession[], event: AgendaEvent, days: string[]): Conflict[] {
  const placed = placedOnly(scheduled);
  const conflicts: Conflict[] = [];
  const dayset = new Set(days);

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (!overlaps(a, b)) continue;

      if (a.roomId != null && a.roomId === b.roomId) {
        conflicts.push({
          kind: "room",
          message: `${a.roomName ?? "Room"} is double-booked: "${a.title}" and "${b.title}" overlap.`,
          sessionIds: [a.id, b.id],
        });
      }

      const shared = a.speakers.filter((speaker) => b.speakers.some((other) => other.contactId === speaker.contactId));
      for (const speaker of shared) {
        conflicts.push({
          kind: "speaker",
          message: `${speaker.name} is double-booked: "${a.title}" and "${b.title}" overlap.`,
          sessionIds: [a.id, b.id],
        });
      }
    }
  }

  for (const session of placed) {
    const day = toZonedDateValue(session.startsAt, event.timezone);
    const start = zonedParts(session.startsAt, event.timezone);
    const end = zonedParts(session.endsAt, event.timezone);
    const endMinutes = end.hour * 60 + end.minute;
    if (days.length > 0 && !dayset.has(day)) {
      conflicts.push({
        kind: "hours",
        message: `"${session.title}" is scheduled on ${day}, which is not an event day.`,
        sessionIds: [session.id],
      });
    } else if (start.hour < AGENDA_START_HOUR || endMinutes > AGENDA_END_HOUR * 60) {
      conflicts.push({
        kind: "hours",
        message: `"${session.title}" falls outside the agenda window (${AGENDA_START_HOUR}:00 to ${AGENDA_END_HOUR}:00).`,
        sessionIds: [session.id],
      });
    }
  }

  return conflicts;
}

async function loadSessions(eventId: number): Promise<AgendaSession[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      abstract: sessions.abstract,
      publicState: sessions.publicState,
      roomId: sessions.roomId,
      roomName: rooms.name,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      trackId: sessions.trackId,
      trackName: tracks.name,
      trackColor: tracks.color,
      formatName: formats.name,
      durationMin: formats.durationMin,
      statusKey: statuses.key,
    })
    .from(sessions)
    .leftJoin(rooms, eq(sessions.roomId, rooms.id))
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .leftJoin(formats, eq(sessions.formatId, formats.id))
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(and(eq(sessions.eventId, eventId), eq(sessions.isDraft, false)))
    .orderBy(asc(sessions.startsAt), asc(sessions.id))
    .all();

  // Only accepted work belongs on an agenda. Anything already placed stays visible
  // even if its status changed later, so nothing silently disappears from the grid.
  const relevant = rows.filter((row) => row.statusKey === "accepted" || row.startsAt != null);
  const ids = relevant.map((row) => row.id);
  const speakerRows =
    ids.length > 0
      ? await db
          .select({
            sessionId: sessionParticipants.sessionId,
            contactId: sessionParticipants.contactId,
            sort: sessionParticipants.sort,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
          })
          .from(sessionParticipants)
          .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
          .where(inArray(sessionParticipants.sessionId, ids))
          .all()
      : [];

  const bySession = new Map<number, AgendaSpeaker[]>();
  for (const row of speakerRows.sort((a, b) => a.sort - b.sort)) {
    const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.email || "Speaker";
    bySession.set(row.sessionId, [...(bySession.get(row.sessionId) ?? []), { contactId: row.contactId, name }]);
  }

  return relevant.map((row) => {
    const duration =
      row.startsAt && row.endsAt
        ? Math.max(SLOT_MINUTES, Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000))
        : (row.durationMin ?? DEFAULT_DURATION_MIN);
    return {
      id: row.id,
      friendlyId: row.friendlyId,
      title: row.title,
      abstract: row.abstract,
      publicState: row.publicState,
      roomId: row.roomId,
      roomName: row.roomName,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      trackId: row.trackId,
      trackName: row.trackName,
      trackColor: row.trackColor,
      formatName: row.formatName,
      durationMin: duration,
      speakers: bySession.get(row.id) ?? [],
    };
  });
}

export async function loadAgenda(eventId: number): Promise<AgendaData> {
  const db = getDb();
  const event = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      timezone: events.timezone,
      location: events.location,
      description: events.description,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      agendaPublishedAt: events.agendaPublishedAt,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const roomRows = await db
    .select({ id: rooms.id, name: rooms.name, capacity: rooms.capacity })
    .from(rooms)
    .where(eq(rooms.eventId, eventId))
    .orderBy(asc(rooms.sort), asc(rooms.id))
    .all();

  const all = await loadSessions(eventId);
  const scheduled = all.filter((s) => s.startsAt != null && s.endsAt != null && s.roomId != null);
  const unscheduled = all.filter((s) => !(s.startsAt != null && s.endsAt != null && s.roomId != null));

  let days = eventDays(event.startsAt, event.endsAt, event.timezone);
  if (days.length === 0) {
    const placedDays = scheduled
      .map((s) => (s.startsAt ? toZonedDateValue(s.startsAt, event.timezone) : null))
      .filter((d): d is string => d != null);
    days = [...new Set(placedDays)].sort();
  }

  return { event, rooms: roomRows, days, scheduled, unscheduled, conflicts: detectConflicts(scheduled, event, days) };
}

export interface Placement {
  sessionId: number;
  roomId: number;
  day: string;
  time: string;
  reason: string;
}

/** Deterministic fallback packer: longest formats first, first free room-slot that
 *  keeps every speaker in one place at a time, tracks spread across rooms. */
export function greedySchedule(data: AgendaData): Placement[] {
  if (data.rooms.length === 0 || data.days.length === 0) return [];

  const taken = placedOnly(data.scheduled).map((s) => ({
    roomId: s.roomId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    speakers: s.speakers.map((sp) => sp.contactId),
  }));

  // Which room a track already leans on, so a track does not stack in one room.
  const trackRoom = new Map<number, number>();
  for (const session of placedOnly(data.scheduled)) {
    if (session.trackId != null && session.roomId != null && !trackRoom.has(session.trackId)) {
      trackRoom.set(session.trackId, session.roomId);
    }
  }

  const queue = [...data.unscheduled].sort((a, b) => b.durationMin - a.durationMin || a.id - b.id);
  const placements: Placement[] = [];

  for (const session of queue) {
    const preferredRoomId = session.trackId != null ? trackRoom.get(session.trackId) : undefined;
    const roomOrder = [
      ...data.rooms.filter((room) => room.id !== preferredRoomId),
      ...data.rooms.filter((room) => room.id === preferredRoomId),
    ];

    let placed = false;
    for (const day of data.days) {
      for (const offset of slotOffsets()) {
        const start = zonedDayTimeToUtc(day, slotTimeValue(offset), data.event.timezone);
        if (!start) continue;
        const end = new Date(start.getTime() + session.durationMin * 60_000);
        const endMinutes = AGENDA_START_HOUR * 60 + offset + session.durationMin;
        if (endMinutes > AGENDA_END_HOUR * 60) continue;

        const speakerBusy = taken.some(
          (slot) =>
            overlaps({ startsAt: start, endsAt: end }, slot) &&
            slot.speakers.some((id) => session.speakers.some((sp) => sp.contactId === id))
        );
        if (speakerBusy) continue;

        for (const room of roomOrder) {
          const roomBusy = taken.some(
            (slot) => slot.roomId === room.id && overlaps({ startsAt: start, endsAt: end }, slot)
          );
          if (roomBusy) continue;

          placements.push({
            sessionId: session.id,
            roomId: room.id,
            day,
            time: slotTimeValue(offset),
            reason: `First free ${room.name} slot that fits ${session.durationMin} minutes with no speaker clash.`,
          });
          taken.push({
            roomId: room.id,
            startsAt: start,
            endsAt: end,
            speakers: session.speakers.map((sp) => sp.contactId),
          });
          if (session.trackId != null && !trackRoom.has(session.trackId)) trackRoom.set(session.trackId, room.id);
          placed = true;
          break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
  }

  return placements;
}

/** Writes one placement. Returns the resulting start/end so callers can queue emails. */
export async function placeSession(
  eventId: number,
  sessionId: number,
  input: { roomId: number | null; day: string; time: string; durationMin: number },
  timezone: string
): Promise<{ startsAt: Date; endsAt: Date } | null> {
  const db = getDb();
  const start = zonedDayTimeToUtc(input.day, input.time, timezone);
  if (!start) return null;
  const end = new Date(start.getTime() + Math.max(SLOT_MINUTES, input.durationMin) * 60_000);
  await db
    .update(sessions)
    .set({ roomId: input.roomId, startsAt: start, endsAt: end, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)));
  return { startsAt: start, endsAt: end };
}

export async function unplaceSession(eventId: number, sessionId: number): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ roomId: null, startsAt: null, endsAt: null, updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)));
}

/** Queues a schedule notice, with the session's current slot as an .ics attachment,
 *  to every confirmed speaker on it. Returns how many were queued. */
export async function notifySchedule(eventId: number, sessionId: number): Promise<number> {
  const { appBaseUrl } = await import("./db.server");
  const { getTemplate, queueBulk } = await import("./comms.server");
  const { buildIcsCalendar } = await import("./ics");
  const { formatDateTime } = await import("./format");

  const data = await loadAgenda(eventId);
  const session = data.scheduled.find((row) => row.id === sessionId);
  if (!session || !session.startsAt || !session.endsAt || session.speakers.length === 0) return 0;

  const db = getDb();
  const emails = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .where(inArray(contacts.id, session.speakers.map((speaker) => speaker.contactId)))
    .all();
  if (emails.length === 0) return 0;

  const ics = buildIcsCalendar(
    [
      {
        uid: `opensession-session-${session.id}@opensession`,
        title: session.title,
        location: [session.roomName, data.event.location].filter(Boolean).join(", ") || null,
        description: data.event.name,
        start: session.startsAt,
        end: session.endsAt,
        url: `${appBaseUrl()}/portal/schedule`,
      },
    ],
    { method: "REQUEST", timezone: data.event.timezone, name: data.event.name }
  );

  const template = await getTemplate(eventId, "schedule");
  return queueBulk({
    event: { id: data.event.id, name: data.event.name },
    templateKey: "schedule",
    subject: template.subject,
    body: template.body,
    recipients: emails.map((contact) => ({
      person: {
        contactId: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
        firstName: contact.firstName,
        email: contact.email,
      },
      extras: {
        talk_title: session.title,
        session_time: formatDateTime(session.startsAt, data.event.timezone),
        room_name: session.roomName ?? "the venue",
      },
      ics: { filename: "session.ics", content: ics },
    })),
  });
}

/** Day/time input defaults for the placement form. */
export function placementDefaults(session: AgendaSession, days: string[], timezone: string) {
  return {
    day: session.startsAt ? toZonedDateValue(session.startsAt, timezone) : (days[0] ?? ""),
    time: session.startsAt ? toZonedTimeValue(session.startsAt, timezone) : slotTimeValue(60),
  };
}
