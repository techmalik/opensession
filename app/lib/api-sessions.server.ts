// The session shape the API returns, and the search and write helpers behind
// /api/v1/event/:id/sessions. Kept out of the route modules so the search endpoint
// and the single-session endpoint cannot drift apart.

import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import {
  contacts,
  formats,
  levels,
  rooms,
  sessionParticipants,
  sessions,
  statuses,
  tracks,
} from "../../database/schema";

export interface ApiSession {
  id: number;
  code: string;
  title: string;
  abstract: string | null;
  isAbstract: boolean;
  isDraft: boolean;
  publicState: string;
  status: { id: number | null; key: string | null; label: string | null };
  track: { id: number | null; name: string | null };
  format: { id: number | null; name: string | null };
  level: { id: number | null; name: string | null };
  room: { id: number | null; name: string | null };
  startsAt: string | null;
  endsAt: string | null;
  submittedAt: string | null;
  updatedAt: string;
  speakers: { contactId: number; name: string; email: string; role: string }[];
}

export async function loadApiSessions(eventId: number, sessionIds?: number[]): Promise<ApiSession[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      abstract: sessions.abstract,
      isAbstract: sessions.isAbstract,
      isDraft: sessions.isDraft,
      publicState: sessions.publicState,
      statusId: sessions.statusId,
      statusKey: statuses.key,
      statusLabel: statuses.label,
      trackId: sessions.trackId,
      trackName: tracks.name,
      formatId: sessions.formatId,
      formatName: formats.name,
      levelId: sessions.levelId,
      levelName: levels.name,
      roomId: sessions.roomId,
      roomName: rooms.name,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      submittedAt: sessions.submittedAt,
      updatedAt: sessions.updatedAt,
    })
    .from(sessions)
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .leftJoin(formats, eq(sessions.formatId, formats.id))
    .leftJoin(levels, eq(sessions.levelId, levels.id))
    .leftJoin(rooms, eq(sessions.roomId, rooms.id))
    .where(eq(sessions.eventId, eventId))
    .orderBy(asc(sessions.id))
    .all();

  const wanted = sessionIds ? rows.filter((row) => sessionIds.includes(row.id)) : rows;
  const ids = wanted.map((row) => row.id);

  const speakerRows =
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
          })
          .from(sessionParticipants)
          .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
          .where(inArray(sessionParticipants.sessionId, ids))
          .all()
      : [];

  return wanted.map((row) => ({
    id: row.id,
    code: row.friendlyId,
    title: row.title,
    abstract: row.abstract,
    isAbstract: row.isAbstract,
    isDraft: row.isDraft,
    publicState: row.publicState,
    status: { id: row.statusId, key: row.statusKey, label: row.statusLabel },
    track: { id: row.trackId, name: row.trackName },
    format: { id: row.formatId, name: row.formatName },
    level: { id: row.levelId, name: row.levelName },
    room: { id: row.roomId, name: row.roomName },
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    speakers: speakerRows
      .filter((speaker) => speaker.sessionId === row.id)
      .sort((a, b) => a.sort - b.sort)
      .map((speaker) => ({
        contactId: speaker.contactId,
        name: `${speaker.firstName ?? ""} ${speaker.lastName ?? ""}`.trim() || (speaker.email ?? "Speaker"),
        email: speaker.email ?? "",
        role: speaker.role,
      })),
  }));
}

export interface SessionQuery {
  q?: string;
  status?: string;
  track?: string;
  format?: string;
  room?: string;
  isAbstract?: boolean;
  isDraft?: boolean;
  publicState?: string;
  scheduled?: boolean;
}

/** POST search: filters are a JSON body, which is what the documented shape uses
 *  and what makes a long list of them readable. */
export function filterApiSessions(rows: ApiSession[], query: SessionQuery): ApiSession[] {
  let result = rows;
  const q = (query.q ?? "").trim().toLowerCase();

  if (q) {
    result = result.filter(
      (row) =>
        row.title.toLowerCase().includes(q) ||
        (row.abstract ?? "").toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q) ||
        row.speakers.some((speaker) => speaker.name.toLowerCase().includes(q))
    );
  }
  if (query.status) result = result.filter((row) => row.status.key === query.status || row.status.label === query.status);
  if (query.track) result = result.filter((row) => row.track.name === query.track);
  if (query.format) result = result.filter((row) => row.format.name === query.format);
  if (query.room) result = result.filter((row) => row.room.name === query.room);
  if (query.publicState) result = result.filter((row) => row.publicState === query.publicState);
  if (typeof query.isAbstract === "boolean") result = result.filter((row) => row.isAbstract === query.isAbstract);
  if (typeof query.isDraft === "boolean") result = result.filter((row) => row.isDraft === query.isDraft);
  if (typeof query.scheduled === "boolean") {
    result = result.filter((row) => (row.startsAt != null && row.room.id != null) === query.scheduled);
  }
  return result;
}
