// Airtable two-way sync. Airtable is where a lot of event teams actually work, so
// this mirrors Sessions, Contacts, and Statuses into a base and accepts edits back.
//
// Shape of the deal:
//   - every mirrored row carries a "Local ID" field, which is the join key
//   - airtable_links maps (table, local id) to an Airtable record id and the hash of
//     what we last pushed, so a push only sends rows that actually changed
//   - pull reads records modified since the last sync and writes an allow-list of
//     fields back into D1
//   - conflicts resolve as latest write wins: whichever side changed last is the one
//     the other side ends up with
//   - nothing here throws out of the job runner. Failures land in jobs.lastError and
//     the Integrations screen, and the next run tries again.
//
// Airtable's REST API allows 5 requests per second per base and 10 records per
// write, so every batch is 10 records with a pause between calls.

import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { getSetting, setSetting } from "./settings.server";
import {
  airtableLinks,
  contacts,
  events,
  sessionParticipants,
  sessions,
  statuses,
  tracks,
} from "../../database/schema";

export interface AirtableEnv {
  DB: D1Database;
  AIRTABLE_API_KEY?: string;
  AIRTABLE_BASE_ID?: string;
}

export const AIRTABLE_TABLES = {
  sessions: "Sessions",
  contacts: "Contacts",
  statuses: "Statuses",
} as const;

export const AIRTABLE_SYNC_KEY = "airtable_sync";

export interface AirtableSyncState {
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastError: string | null;
  pushed: number;
  pulled: number;
  schemaReady: boolean;
}

const EMPTY_STATE: AirtableSyncState = {
  lastPushAt: null,
  lastPullAt: null,
  lastError: null,
  pushed: 0,
  pulled: 0,
  schemaReady: false,
};

export function airtableConfigured(env: AirtableEnv): boolean {
  return Boolean(env.AIRTABLE_API_KEY && env.AIRTABLE_BASE_ID);
}

export function airtableBaseUrl(env: AirtableEnv): string | null {
  return env.AIRTABLE_BASE_ID ? `https://airtable.com/${env.AIRTABLE_BASE_ID}` : null;
}

export async function airtableState(): Promise<AirtableSyncState> {
  return getSetting<AirtableSyncState>(AIRTABLE_SYNC_KEY, EMPTY_STATE);
}

async function patchState(patch: Partial<AirtableSyncState>): Promise<AirtableSyncState> {
  const next = { ...(await airtableState()), ...patch };
  await setSetting(AIRTABLE_SYNC_KEY, next);
  return next;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 4 requests per second, comfortably under Airtable's limit of 5. */
const THROTTLE_MS = 250;

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Short, stable digest of what we last pushed for a row. */
function hashFields(fields: Record<string, unknown>): string {
  const text = JSON.stringify(fields, Object.keys(fields).sort());
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

async function airtableFetch(
  env: AirtableEnv,
  path: string,
  init: RequestInit = {}
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Airtable ${res.status} on ${path}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

// ---------- Schema ----------

const TABLE_FIELDS: Record<string, { name: string; type: string; options?: Record<string, unknown> }[]> = {
  Sessions: [
    { name: "Local ID", type: "number", options: { precision: 0 } },
    { name: "Title", type: "singleLineText" },
    { name: "Abstract", type: "multilineText" },
    { name: "Status", type: "singleLineText" },
    { name: "Track", type: "singleLineText" },
    { name: "Format", type: "singleLineText" },
    { name: "Room", type: "singleLineText" },
    { name: "Starts At", type: "singleLineText" },
    { name: "Speakers", type: "singleLineText" },
    { name: "Event", type: "singleLineText" },
  ],
  Contacts: [
    { name: "Local ID", type: "number", options: { precision: 0 } },
    { name: "Name", type: "singleLineText" },
    { name: "Email", type: "email" },
    { name: "Title", type: "singleLineText" },
    { name: "Company", type: "singleLineText" },
    { name: "Bio", type: "multilineText" },
  ],
  Statuses: [
    { name: "Local ID", type: "number", options: { precision: 0 } },
    { name: "Key", type: "singleLineText" },
    { name: "Label", type: "singleLineText" },
  ],
};

/** Creates any missing mirror table. Existing tables are left exactly as they are:
 *  a team's own extra columns are none of our business. */
export async function ensureBaseSchema(env: AirtableEnv): Promise<{ created: string[]; existing: string[] }> {
  const meta = (await airtableFetch(env, `meta/bases/${env.AIRTABLE_BASE_ID}/tables`)) as {
    tables?: { id: string; name: string }[];
  };
  const present = new Set((meta.tables ?? []).map((table) => table.name));
  const created: string[] = [];

  for (const [name, fields] of Object.entries(TABLE_FIELDS)) {
    if (present.has(name)) continue;
    await airtableFetch(env, `meta/bases/${env.AIRTABLE_BASE_ID}/tables`, {
      method: "POST",
      body: JSON.stringify({ name, description: `OpenSession mirror of ${name.toLowerCase()}`, fields }),
    });
    created.push(name);
    await sleep(THROTTLE_MS);
  }

  await patchState({ schemaReady: true });
  return { created, existing: [...present].filter((name) => name in TABLE_FIELDS) };
}

// ---------- Local snapshot ----------

interface LocalRow {
  table: string;
  recordId: number;
  fields: Record<string, unknown>;
}

async function localRows(env: AirtableEnv): Promise<LocalRow[]> {
  const db = drizzle(env.DB);
  const rows: LocalRow[] = [];

  const eventRows = await db.select({ id: events.id, name: events.name, timezone: events.timezone }).from(events).all();
  const eventName = new Map(eventRows.map((row) => [row.id, row.name]));

  const sessionRows = await db
    .select({
      id: sessions.id,
      eventId: sessions.eventId,
      title: sessions.title,
      abstract: sessions.abstract,
      startsAt: sessions.startsAt,
      statusLabel: statuses.label,
      trackName: tracks.name,
      isDraft: sessions.isDraft,
    })
    .from(sessions)
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .all();

  const participantRows = await db
    .select({
      sessionId: sessionParticipants.sessionId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      sort: sessionParticipants.sort,
    })
    .from(sessionParticipants)
    .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
    .all();
  const speakerNames = new Map<number, string[]>();
  for (const row of participantRows.sort((a, b) => a.sort - b.sort)) {
    const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
    if (!name) continue;
    speakerNames.set(row.sessionId, [...(speakerNames.get(row.sessionId) ?? []), name]);
  }

  for (const row of sessionRows) {
    rows.push({
      table: "sessions",
      recordId: row.id,
      fields: {
        "Local ID": row.id,
        Title: row.title,
        Abstract: row.abstract ?? "",
        Status: row.statusLabel ?? "Pending",
        Track: row.trackName ?? "",
        "Starts At": row.startsAt ? row.startsAt.toISOString() : "",
        Speakers: (speakerNames.get(row.id) ?? []).join(", "),
        Event: eventName.get(row.eventId) ?? "",
      },
    });
  }

  const contactRows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      title: contacts.title,
      company: contacts.company,
      bio: contacts.bio,
    })
    .from(contacts)
    .all();
  for (const row of contactRows) {
    rows.push({
      table: "contacts",
      recordId: row.id,
      fields: {
        "Local ID": row.id,
        Name: `${row.firstName} ${row.lastName}`.trim() || row.email,
        Email: row.email,
        Title: row.title ?? "",
        Company: row.company ?? "",
        Bio: row.bio ?? "",
      },
    });
  }

  const statusRows = await db.select({ id: statuses.id, key: statuses.key, label: statuses.label }).from(statuses).all();
  for (const row of statusRows) {
    rows.push({
      table: "statuses",
      recordId: row.id,
      fields: { "Local ID": row.id, Key: row.key, Label: row.label },
    });
  }

  return rows;
}

// ---------- Push ----------

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/** Sends every local row whose hash moved since the last push. Rows Airtable has
 *  never seen are created; the rest are patched. */
export async function pushToAirtable(env: AirtableEnv): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  if (!airtableConfigured(env)) return result;

  const db = drizzle(env.DB);
  try {
    const state = await airtableState();
    if (!state.schemaReady) await ensureBaseSchema(env);

    const rows = await localRows(env);
    const links = await db.select().from(airtableLinks).all();
    const linkFor = new Map(links.map((link) => [`${link.tableName}:${link.recordId}`, link]));

    for (const [table, tableName] of Object.entries(AIRTABLE_TABLES)) {
      const forTable = rows.filter((row) => row.table === table);
      const toCreate: LocalRow[] = [];
      const toUpdate: { row: LocalRow; airtableId: string }[] = [];

      for (const row of forTable) {
        const link = linkFor.get(`${table}:${row.recordId}`);
        const hash = hashFields(row.fields);
        if (!link) toCreate.push(row);
        else if (link.lastPushedHash !== hash) toUpdate.push({ row, airtableId: link.airtableId });
        else result.skipped += 1;
      }

      for (const batch of chunk(toCreate, 10)) {
        const body = { records: batch.map((row) => ({ fields: row.fields })), typecast: true };
        const response = (await airtableFetch(env, `${env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`, {
          method: "POST",
          body: JSON.stringify(body),
        })) as { records?: AirtableRecord[] };

        const created = response.records ?? [];
        for (let i = 0; i < batch.length; i++) {
          const record = created[i];
          if (!record) continue;
          await db.insert(airtableLinks).values({
            tableName: batch[i].table,
            recordId: batch[i].recordId,
            airtableId: record.id,
            lastPushedHash: hashFields(batch[i].fields),
            lastSyncedAt: new Date(),
          });
          result.created += 1;
        }
        await sleep(THROTTLE_MS);
      }

      for (const batch of chunk(toUpdate, 10)) {
        const body = {
          records: batch.map((item) => ({ id: item.airtableId, fields: item.row.fields })),
          typecast: true,
        };
        await airtableFetch(env, `${env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        for (const item of batch) {
          await db
            .update(airtableLinks)
            .set({ lastPushedHash: hashFields(item.row.fields), lastSyncedAt: new Date() })
            .where(and(eq(airtableLinks.tableName, item.row.table), eq(airtableLinks.recordId, item.row.recordId)));
          result.updated += 1;
        }
        await sleep(THROTTLE_MS);
      }
    }

    await patchState({
      lastPushAt: new Date().toISOString(),
      pushed: result.created + result.updated,
      lastError: null,
    });
  } catch (err) {
    result.errors.push(String(err).slice(0, 400));
    await patchState({ lastError: String(err).slice(0, 400) });
  }
  return result;
}

// ---------- Pull ----------

async function listRecords(env: AirtableEnv, tableName: string, since: string | null): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    if (since) params.set("filterByFormula", `IS_AFTER(LAST_MODIFIED_TIME(), DATETIME_PARSE('${since}'))`);

    let page: { records?: AirtableRecord[]; offset?: string };
    try {
      page = (await airtableFetch(env, `${env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}?${params}`)) as {
        records?: AirtableRecord[];
        offset?: string;
      };
    } catch (err) {
      // A base whose records predate the formula, or a field the formula cannot
      // read, should not stop the sync: fall back to reading everything once.
      if (!since) throw err;
      return listRecords(env, tableName, null);
    }

    records.push(...(page.records ?? []));
    offset = page.offset;
    await sleep(THROTTLE_MS);
  } while (offset);

  return records;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Writes an allow-list of fields back into D1. Anything else Airtable holds is
 *  presentation for the team and is ignored here. */
export async function pullFromAirtable(env: AirtableEnv): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  if (!airtableConfigured(env)) return result;

  const db = drizzle(env.DB);
  try {
    const state = await airtableState();
    const since = state.lastPullAt;

    // Sessions: title, abstract, status by label, track by name.
    const sessionRecords = await listRecords(env, AIRTABLE_TABLES.sessions, since);
    const statusRows = await db.select({ id: statuses.id, key: statuses.key, label: statuses.label, eventId: statuses.eventId }).from(statuses).all();
    const trackRows = await db.select({ id: tracks.id, name: tracks.name, eventId: tracks.eventId }).from(tracks).all();

    for (const record of sessionRecords) {
      const localId = Number(record.fields["Local ID"]);
      if (!Number.isInteger(localId) || localId <= 0) {
        result.skipped += 1;
        continue;
      }
      const current = await db.select().from(sessions).where(eq(sessions.id, localId)).get();
      if (!current) {
        result.skipped += 1;
        continue;
      }

      const patch: Record<string, unknown> = {};
      const title = text(record.fields.Title);
      const abstract = text(record.fields.Abstract);
      if (title && title !== current.title) patch.title = title;
      if (abstract !== (current.abstract ?? "")) patch.abstract = abstract || null;

      const statusLabel = text(record.fields.Status);
      if (statusLabel) {
        const status = statusRows.find(
          (row) => row.eventId === current.eventId && row.label.toLowerCase() === statusLabel.toLowerCase()
        );
        if (status && status.id !== current.statusId) {
          patch.statusId = status.id;
          patch.isAbstract = status.key !== "accepted";
        }
      }

      const trackName = text(record.fields.Track);
      if (trackName) {
        const track = trackRows.find(
          (row) => row.eventId === current.eventId && row.name.toLowerCase() === trackName.toLowerCase()
        );
        if (track && track.id !== current.trackId) patch.trackId = track.id;
      }

      if (Object.keys(patch).length === 0) {
        result.skipped += 1;
        continue;
      }
      await db.update(sessions).set({ ...patch, updatedAt: new Date() }).where(eq(sessions.id, localId));
      // The remote copy is now the newer one, so the next push must not clobber it.
      await db
        .update(airtableLinks)
        .set({ lastPushedHash: null, lastSyncedAt: new Date() })
        .where(and(eq(airtableLinks.tableName, "sessions"), eq(airtableLinks.recordId, localId)));
      result.updated += 1;
    }

    // Contacts: bio and company only. Names and emails stay authoritative locally,
    // because they are identity, not content.
    const contactRecords = await listRecords(env, AIRTABLE_TABLES.contacts, since);
    for (const record of contactRecords) {
      const localId = Number(record.fields["Local ID"]);
      if (!Number.isInteger(localId) || localId <= 0) {
        result.skipped += 1;
        continue;
      }
      const current = await db.select().from(contacts).where(eq(contacts.id, localId)).get();
      if (!current) {
        result.skipped += 1;
        continue;
      }

      const patch: Record<string, unknown> = {};
      const bio = text(record.fields.Bio);
      const company = text(record.fields.Company);
      if (bio !== (current.bio ?? "")) patch.bio = bio || null;
      if (company !== (current.company ?? "")) patch.company = company || null;

      if (Object.keys(patch).length === 0) {
        result.skipped += 1;
        continue;
      }
      await db.update(contacts).set({ ...patch, updatedAt: new Date() }).where(eq(contacts.id, localId));
      await db
        .update(airtableLinks)
        .set({ lastPushedHash: null, lastSyncedAt: new Date() })
        .where(and(eq(airtableLinks.tableName, "contacts"), eq(airtableLinks.recordId, localId)));
      result.updated += 1;
    }

    await patchState({ lastPullAt: new Date().toISOString(), pulled: result.updated, lastError: null });
  } catch (err) {
    result.errors.push(String(err).slice(0, 400));
    await patchState({ lastError: String(err).slice(0, 400) });
  }
  return result;
}

/** Row counts per mirrored table, for the Integrations screen. */
export async function airtableCounts(env: AirtableEnv): Promise<{ table: string; local: number; linked: number }[]> {
  const db = drizzle(env.DB);
  const links = await db.select({ tableName: airtableLinks.tableName }).from(airtableLinks).all();
  const rows = await localRows(env);
  return Object.keys(AIRTABLE_TABLES).map((table) => ({
    table,
    local: rows.filter((row) => row.table === table).length,
    linked: links.filter((link) => link.tableName === table).length,
  }));
}

/** Drops the record mapping. The next push recreates every row in Airtable. */
export async function resetAirtableLinks(env: AirtableEnv): Promise<void> {
  const db = drizzle(env.DB);
  await db.delete(airtableLinks).where(inArray(airtableLinks.tableName, Object.keys(AIRTABLE_TABLES)));
  await patchState({ lastPushAt: null, lastPullAt: null, pushed: 0, pulled: 0, schemaReady: false });
}
