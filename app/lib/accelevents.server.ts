// Accelevents push. Their platform runs the attendee-facing event; this keeps their
// agenda and speaker records in step with ours.
//
// Written against Accelevents' documented public API shape (bearer token, event
// scoped session and speaker collections). The base URL is configurable because
// that is the part most likely to differ per account, and every attempt, including
// every failure, is written to the push log so a wrong key is visible rather than
// silent. Nothing here can be verified end to end without a real account, which is
// why the integration is explicitly best effort: it dry runs without credentials
// and never blocks anything else.

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getSetting, setSetting } from "./settings.server";
import { contacts, events, formats, rooms, sessionParticipants, sessions, statuses, tracks } from "../../database/schema";

export interface AccelConfig {
  apiKey: string;
  eventId: string;
  baseUrl: string;
  enabled: boolean;
}

export interface AccelLogEntry {
  at: string;
  ok: boolean;
  sessions: number;
  speakers: number;
  message: string;
}

export interface AccelState {
  config: AccelConfig;
  lastPushAt: string | null;
  log: AccelLogEntry[];
}

export const ACCEL_KEY = "accelevents";
export const ACCEL_DEFAULT_BASE = "https://api.accelevents.com/api/v2";

const EMPTY: AccelState = {
  config: { apiKey: "", eventId: "", baseUrl: ACCEL_DEFAULT_BASE, enabled: false },
  lastPushAt: null,
  log: [],
};

export async function accelState(): Promise<AccelState> {
  const state = await getSetting<AccelState>(ACCEL_KEY, EMPTY);
  return { ...EMPTY, ...state, config: { ...EMPTY.config, ...(state.config ?? {}) } };
}

export async function saveAccelConfig(config: Partial<AccelConfig>): Promise<AccelState> {
  const state = await accelState();
  const next: AccelState = { ...state, config: { ...state.config, ...config } };
  await setSetting(ACCEL_KEY, next);
  return next;
}

export function accelConfigured(state: AccelState): boolean {
  return Boolean(state.config.apiKey && state.config.eventId);
}

/** Shown in Settings so an organizer can see exactly what crosses the boundary
 *  before anything is sent. */
export const ACCEL_FIELD_MAP: { ours: string; theirs: string; note: string }[] = [
  { ours: "session.title", theirs: "title", note: "Session name on their agenda" },
  { ours: "session.abstract", theirs: "description", note: "Plain text, HTML is stripped by their side" },
  { ours: "session.startsAt", theirs: "startTime", note: "ISO 8601 in UTC" },
  { ours: "session.endsAt", theirs: "endTime", note: "ISO 8601 in UTC" },
  { ours: "room.name", theirs: "location", note: "Matched by name, created if missing" },
  { ours: "track.name", theirs: "track", note: "Matched by name" },
  { ours: "format.name", theirs: "sessionType", note: "Matched by name" },
  { ours: "session.friendlyId", theirs: "externalId", note: "Join key, so a second push updates rather than duplicates" },
  { ours: "contact.firstName", theirs: "firstName", note: "Speaker record" },
  { ours: "contact.lastName", theirs: "lastName", note: "Speaker record" },
  { ours: "contact.email", theirs: "email", note: "Their speaker identity key" },
  { ours: "contact.title", theirs: "jobTitle", note: "Speaker record" },
  { ours: "contact.company", theirs: "company", note: "Speaker record" },
  { ours: "contact.bio", theirs: "biography", note: "Speaker record" },
];

export interface AccelPayload {
  sessions: Record<string, unknown>[];
  speakers: Record<string, unknown>[];
}

/** Exactly what a push would send: accepted, scheduled, publicly visible sessions
 *  and the people on them. */
export async function buildAccelPayload(db: D1Database, eventId: number): Promise<AccelPayload> {
  const orm = drizzle(db);

  const rows = await orm
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      abstract: sessions.abstract,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      publicState: sessions.publicState,
      statusKey: statuses.key,
      roomName: rooms.name,
      trackName: tracks.name,
      formatName: formats.name,
    })
    .from(sessions)
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .leftJoin(rooms, eq(sessions.roomId, rooms.id))
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .leftJoin(formats, eq(sessions.formatId, formats.id))
    .where(eq(sessions.eventId, eventId))
    .all();

  const live = rows.filter(
    (row) => row.statusKey === "accepted" && row.publicState === "published" && row.startsAt && row.endsAt
  );

  const participantRows = await orm
    .select({
      sessionId: sessionParticipants.sessionId,
      contactId: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      title: contacts.title,
      company: contacts.company,
      bio: contacts.bio,
      sort: sessionParticipants.sort,
    })
    .from(sessionParticipants)
    .innerJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
    .all();

  const liveIds = new Set(live.map((row) => row.id));
  const mine = participantRows.filter((row) => liveIds.has(row.sessionId)).sort((a, b) => a.sort - b.sort);

  const speakers = new Map<number, Record<string, unknown>>();
  for (const row of mine) {
    if (speakers.has(row.contactId)) continue;
    speakers.set(row.contactId, {
      externalId: `contact-${row.contactId}`,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      jobTitle: row.title ?? "",
      company: row.company ?? "",
      biography: row.bio ?? "",
    });
  }

  return {
    sessions: live.map((row) => ({
      externalId: row.friendlyId,
      title: row.title,
      description: (row.abstract ?? "").replace(/<[^>]+>/g, ""),
      startTime: row.startsAt?.toISOString(),
      endTime: row.endsAt?.toISOString(),
      location: row.roomName ?? "",
      track: row.trackName ?? "",
      sessionType: row.formatName ?? "",
      speakerEmails: mine.filter((p) => p.sessionId === row.id).map((p) => p.email),
    })),
    speakers: [...speakers.values()],
  };
}

export interface AccelDryRun {
  payload: AccelPayload;
  summary: { sessions: number; speakers: number };
  endpoints: { sessions: string; speakers: string };
  configured: boolean;
}

export async function accelDryRun(db: D1Database, eventId: number): Promise<AccelDryRun> {
  const state = await accelState();
  const payload = await buildAccelPayload(db, eventId);
  const base = state.config.baseUrl || ACCEL_DEFAULT_BASE;
  const remote = state.config.eventId || "<event id>";
  return {
    payload,
    summary: { sessions: payload.sessions.length, speakers: payload.speakers.length },
    endpoints: {
      sessions: `POST ${base}/${remote}/sessions`,
      speakers: `POST ${base}/${remote}/speakers`,
    },
    configured: accelConfigured(state),
  };
}

async function appendLog(entry: AccelLogEntry): Promise<void> {
  const state = await accelState();
  await setSetting(ACCEL_KEY, {
    ...state,
    lastPushAt: entry.at,
    log: [entry, ...state.log].slice(0, 20),
  });
}

export interface AccelEnv {
  DB: D1Database;
}

/** The hourly push. Runs for every active event, records one log line per event,
 *  and never throws: a broken integration must not stop email or Airtable work. */
export async function pushToAccelevents(env: AccelEnv): Promise<AccelLogEntry[]> {
  const state = await accelState();
  if (!state.config.enabled || !accelConfigured(state)) return [];

  const orm = drizzle(env.DB);
  const activeEvents = await orm.select({ id: events.id, name: events.name }).from(events).where(eq(events.status, "active")).all();
  const entries: AccelLogEntry[] = [];

  for (const event of activeEvents) {
    const payload = await buildAccelPayload(env.DB, event.id);
    const at = new Date().toISOString();
    if (payload.sessions.length === 0 && payload.speakers.length === 0) {
      const entry = { at, ok: true, sessions: 0, speakers: 0, message: `${event.name}: nothing publishable to push.` };
      entries.push(entry);
      await appendLog(entry);
      continue;
    }

    try {
      const base = `${state.config.baseUrl || ACCEL_DEFAULT_BASE}/${state.config.eventId}`;
      const headers = {
        Authorization: `Bearer ${state.config.apiKey}`,
        "Content-Type": "application/json",
      };

      for (const [path, records] of [
        ["speakers", payload.speakers],
        ["sessions", payload.sessions],
      ] as const) {
        if (records.length === 0) continue;
        const res = await fetch(`${base}/${path}`, { method: "POST", headers, body: JSON.stringify({ data: records }) });
        if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }

      const entry = {
        at,
        ok: true,
        sessions: payload.sessions.length,
        speakers: payload.speakers.length,
        message: `${event.name}: pushed.`,
      };
      entries.push(entry);
      await appendLog(entry);
    } catch (err) {
      const entry = {
        at,
        ok: false,
        sessions: payload.sessions.length,
        speakers: payload.speakers.length,
        message: `${event.name}: ${String(err).slice(0, 300)}`,
      };
      entries.push(entry);
      await appendLog(entry);
    }
  }

  return entries;
}
