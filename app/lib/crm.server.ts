// Speaker CRM: the organization-level contact database that sits above events.
//
// The same contacts table backs both this and each event's speaker roster; what
// makes this the CRM is that nothing here is scoped to an event. A contact exists
// whether or not it has been pushed into one, and its history across every event is
// part of the record.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import { CRM_STAGES, type CrmStage } from "./crm-view";
import {
  contacts,
  crmFields,
  crmNotes,
  crmProspectEvents,
  crmProspects,
  crmSegmentMembers,
  crmSegments,
  emailSends,
  eventContacts,
  events,
  sessionParticipants,
  sessions,
  statuses,
} from "../../database/schema";

export type { CrmStage } from "./crm-view";

export interface CrmContactRow {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  tags: string[];
  custom: Record<string, string>;
  eventCount: number;
  sessionCount: number;
  /** Another contact shares this name. Drives the duplicate indicator. */
  duplicateOf: number | null;
  stage: CrmStage | null;
  createdAt: Date;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

export function nameKey(first: string, last: string): string {
  return `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface CrmFilters {
  q?: string;
  company?: string;
  title?: string;
  tag?: string;
  segmentId?: number;
  stage?: string;
  hasEvent?: string;
}

/** Every contact in the organization, with the cross-event counts the directory
 *  and the dashboard both read. */
export async function listContacts(filters: CrmFilters = {}): Promise<CrmContactRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      title: contacts.title,
      company: contacts.company,
      bio: contacts.bio,
      tagsJson: contacts.tagsJson,
      customJson: contacts.customJson,
      createdAt: contacts.createdAt,
    })
    .from(contacts)
    .orderBy(asc(contacts.lastName), asc(contacts.firstName), asc(contacts.id))
    .all();

  const links = await db.select({ contactId: eventContacts.contactId, eventId: eventContacts.eventId }).from(eventContacts).all();
  const participants = await db
    .select({ contactId: sessionParticipants.contactId })
    .from(sessionParticipants)
    .all();
  const prospects = await db.select({ contactId: crmProspects.contactId, stage: crmProspects.stage }).from(crmProspects).all();

  const eventsByContact = new Map<number, Set<number>>();
  for (const link of links) {
    const set = eventsByContact.get(link.contactId) ?? new Set<number>();
    set.add(link.eventId);
    eventsByContact.set(link.contactId, set);
  }
  const sessionCount = new Map<number, number>();
  for (const row of participants) sessionCount.set(row.contactId, (sessionCount.get(row.contactId) ?? 0) + 1);
  const stageByContact = new Map(prospects.map((row) => [row.contactId, row.stage as CrmStage]));

  // Same name, different record: the CRM-06 duplicate signal.
  const byName = new Map<string, number[]>();
  for (const row of rows) {
    const key = nameKey(row.firstName, row.lastName);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), row.id]);
  }

  let result: CrmContactRow[] = rows.map((row) => {
    const key = nameKey(row.firstName, row.lastName);
    const sameName = (byName.get(key) ?? []).filter((id) => id !== row.id);
    return {
      id: row.id,
      name: `${row.firstName} ${row.lastName}`.trim() || row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      title: row.title,
      company: row.company,
      bio: row.bio,
      tags: parseJson<string[]>(row.tagsJson, []),
      custom: parseJson<Record<string, string>>(row.customJson, {}),
      eventCount: eventsByContact.get(row.id)?.size ?? 0,
      sessionCount: sessionCount.get(row.id) ?? 0,
      duplicateOf: sameName[0] ?? null,
      stage: stageByContact.get(row.id) ?? null,
      createdAt: row.createdAt,
    };
  });

  if (filters.segmentId) {
    const segment = await getSegment(filters.segmentId);
    if (segment) {
      if (segment.kind === "curated") {
        const members = new Set(segment.memberIds);
        result = result.filter((row) => members.has(row.id));
      } else {
        result = applyAttributeFilters(result, segment.filters);
      }
    }
  }

  return applyAttributeFilters(result, filters);
}

function applyAttributeFilters(rows: CrmContactRow[], filters: CrmFilters): CrmContactRow[] {
  let result = rows;
  const q = (filters.q ?? "").trim().toLowerCase();
  if (q) {
    result = result.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        (row.company ?? "").toLowerCase().includes(q) ||
        (row.title ?? "").toLowerCase().includes(q)
    );
  }
  if (filters.company) result = result.filter((row) => (row.company ?? "") === filters.company);
  if (filters.title) result = result.filter((row) => (row.title ?? "") === filters.title);
  if (filters.tag) result = result.filter((row) => row.tags.includes(filters.tag as string));
  if (filters.stage) result = result.filter((row) => row.stage === filters.stage);
  if (filters.hasEvent === "yes") result = result.filter((row) => row.eventCount > 0);
  if (filters.hasEvent === "no") result = result.filter((row) => row.eventCount === 0);
  return result;
}

/** Distinct values behind the directory's filter dropdowns. */
export async function filterOptions(): Promise<{ companies: string[]; titles: string[]; tags: string[] }> {
  const rows = await listContacts();
  return {
    companies: [...new Set(rows.map((row) => row.company).filter((v): v is string => Boolean(v)))].sort(),
    titles: [...new Set(rows.map((row) => row.title).filter((v): v is string => Boolean(v)))].sort(),
    tags: [...new Set(rows.flatMap((row) => row.tags))].sort(),
  };
}

// ---------- Profile ----------

export interface CrmConnection {
  eventId: number;
  eventName: string;
  role: string;
  sessions: { id: number; title: string; statusLabel: string | null }[];
}

export interface CrmActivityEntry {
  kind: "note" | "email" | "stage" | "event";
  at: Date;
  title: string;
  detail: string;
  author: string;
}

export async function getContact(contactId: number) {
  const db = getDb();
  const row = await db.select().from(contacts).where(eq(contacts.id, contactId)).get();
  if (!row) return null;
  return {
    ...row,
    name: `${row.firstName} ${row.lastName}`.trim() || row.email,
    tags: parseJson<string[]>(row.tagsJson, []),
    custom: parseJson<Record<string, string>>(row.customJson, {}),
  };
}

/** Which events and sessions this person is connected to, across the whole org. */
export async function contactConnections(contactId: number): Promise<CrmConnection[]> {
  const db = getDb();

  const links = await db
    .select({ eventId: eventContacts.eventId, kind: eventContacts.kind, eventName: events.name })
    .from(eventContacts)
    .leftJoin(events, eq(eventContacts.eventId, events.id))
    .where(eq(eventContacts.contactId, contactId))
    .all();

  const sessionRows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      eventId: sessions.eventId,
      eventName: events.name,
      statusLabel: statuses.label,
    })
    .from(sessionParticipants)
    .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
    .leftJoin(events, eq(sessions.eventId, events.id))
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(eq(sessionParticipants.contactId, contactId))
    .all();

  const byEvent = new Map<number, CrmConnection>();
  for (const link of links) {
    byEvent.set(link.eventId, {
      eventId: link.eventId,
      eventName: link.eventName ?? "Event",
      role: link.kind,
      sessions: [],
    });
  }
  for (const row of sessionRows) {
    const entry = byEvent.get(row.eventId) ?? {
      eventId: row.eventId,
      eventName: row.eventName ?? "Event",
      role: "speaker",
      sessions: [],
    };
    entry.sessions.push({ id: row.id, title: row.title, statusLabel: row.statusLabel });
    byEvent.set(row.eventId, entry);
  }
  return [...byEvent.values()];
}

/** Notes, mail, stage moves, and event links in one timeline. */
export async function contactActivity(contactId: number): Promise<CrmActivityEntry[]> {
  const db = getDb();
  const entries: CrmActivityEntry[] = [];

  const notes = await db.select().from(crmNotes).where(eq(crmNotes.contactId, contactId)).all();
  for (const note of notes) {
    entries.push({ kind: "note", at: note.createdAt, title: "Note added", detail: note.body, author: note.authorName });
  }

  const mail = await db
    .select({ subject: emailSends.subject, status: emailSends.status, createdAt: emailSends.createdAt })
    .from(emailSends)
    .where(eq(emailSends.toContactId, contactId))
    .all();
  for (const row of mail) {
    entries.push({ kind: "email", at: row.createdAt, title: row.subject, detail: `Email ${row.status}`, author: "System" });
  }

  const prospect = await db.select({ id: crmProspects.id }).from(crmProspects).where(eq(crmProspects.contactId, contactId)).get();
  if (prospect) {
    const moves = await db.select().from(crmProspectEvents).where(eq(crmProspectEvents.prospectId, prospect.id)).all();
    for (const move of moves) {
      entries.push({
        kind: "stage",
        at: move.createdAt,
        title:
          move.kind === "stage"
            ? `Pipeline stage ${move.fromStage ?? "none"} to ${move.toStage ?? "none"}`
            : move.kind === "enrolled"
              ? "Enrolled in the sourcing pipeline"
              : "Pipeline note",
        detail: move.body ?? "",
        author: move.authorName,
      });
    }
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export async function listNotes(contactId: number) {
  const db = getDb();
  return db
    .select()
    .from(crmNotes)
    .where(eq(crmNotes.contactId, contactId))
    .orderBy(desc(crmNotes.createdAt), desc(crmNotes.id))
    .all();
}

export async function addNote(contactId: number, body: string, author: { id: number | null; name: string }) {
  const db = getDb();
  await db.insert(crmNotes).values({
    contactId,
    body,
    authorUserId: author.id,
    authorName: author.name,
    createdAt: new Date(),
  });
}

export async function setTags(contactId: number, tags: string[]) {
  const db = getDb();
  await db
    .update(contacts)
    .set({ tagsJson: JSON.stringify([...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]), updatedAt: new Date() })
    .where(eq(contacts.id, contactId));
}

export async function setCustomValues(contactId: number, values: Record<string, string>) {
  const db = getDb();
  const row = await db.select({ customJson: contacts.customJson }).from(contacts).where(eq(contacts.id, contactId)).get();
  if (!row) return;
  const merged = { ...parseJson<Record<string, string>>(row.customJson, {}), ...values };
  for (const key of Object.keys(merged)) if (!merged[key]) delete merged[key];
  await db.update(contacts).set({ customJson: JSON.stringify(merged), updatedAt: new Date() }).where(eq(contacts.id, contactId));
}

// ---------- Custom fields ----------

export async function listFields() {
  const db = getDb();
  return db.select().from(crmFields).orderBy(asc(crmFields.sort), asc(crmFields.id)).all();
}

export async function createField(input: { label: string; type: "text" | "select"; options: string[] }) {
  const db = getDb();
  const fieldKey = input.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
  const existing = await db.select({ id: crmFields.id }).from(crmFields).where(eq(crmFields.fieldKey, fieldKey)).get();
  if (existing) return { fieldKey, created: false };
  await db.insert(crmFields).values({
    fieldKey,
    label: input.label,
    type: input.type,
    optionsJson: JSON.stringify(input.options),
    sort: 0,
    createdAt: new Date(),
  });
  return { fieldKey, created: true };
}

export async function deleteField(id: number) {
  const db = getDb();
  await db.delete(crmFields).where(eq(crmFields.id, id));
}

// ---------- Segments ----------

export interface SegmentRow {
  id: number;
  name: string;
  kind: "dynamic" | "curated";
  filters: CrmFilters;
  memberIds: number[];
  count: number;
}

export async function listSegments(): Promise<SegmentRow[]> {
  const db = getDb();
  const rows = await db.select().from(crmSegments).orderBy(asc(crmSegments.name)).all();
  const members = await db.select().from(crmSegmentMembers).all();
  const all = await listContacts();

  return rows.map((row) => {
    const memberIds = members.filter((m) => m.segmentId === row.id).map((m) => m.contactId);
    const filters = parseJson<CrmFilters>(row.filtersJson, {});
    const count =
      row.kind === "curated" ? memberIds.length : applyAttributeFilters(all, filters).length;
    return { id: row.id, name: row.name, kind: row.kind, filters, memberIds, count };
  });
}

export async function getSegment(id: number): Promise<SegmentRow | null> {
  const rows = await listSegments();
  return rows.find((row) => row.id === id) ?? null;
}

export async function createSegment(input: {
  name: string;
  kind: "dynamic" | "curated";
  filters: CrmFilters;
  memberIds: number[];
  userId: number | null;
}): Promise<number> {
  const db = getDb();
  const created = await db
    .insert(crmSegments)
    .values({
      name: input.name,
      kind: input.kind,
      filtersJson: JSON.stringify(input.filters),
      createdBy: input.userId,
      createdAt: new Date(),
    })
    .returning({ id: crmSegments.id })
    .get();

  if (input.kind === "curated" && input.memberIds.length > 0) {
    for (const contactId of input.memberIds) {
      await db.insert(crmSegmentMembers).values({ segmentId: created.id, contactId }).onConflictDoNothing();
    }
  }
  return created.id;
}

export async function deleteSegment(id: number) {
  const db = getDb();
  await db.delete(crmSegmentMembers).where(eq(crmSegmentMembers.segmentId, id));
  await db.delete(crmSegments).where(eq(crmSegments.id, id));
}

// ---------- Pipeline ----------

export interface ProspectCard {
  id: number;
  contactId: number;
  name: string;
  email: string;
  title: string | null;
  company: string | null;
  stage: CrmStage;
  score: number | null;
  rationale: string | null;
  eventId: number | null;
  eventName: string | null;
  noteCount: number;
  updatedAt: Date;
}

export async function listProspects(): Promise<ProspectCard[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: crmProspects.id,
      contactId: crmProspects.contactId,
      stage: crmProspects.stage,
      score: crmProspects.score,
      rationale: crmProspects.rationale,
      eventId: crmProspects.eventId,
      eventName: events.name,
      sort: crmProspects.sort,
      updatedAt: crmProspects.updatedAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      title: contacts.title,
      company: contacts.company,
    })
    .from(crmProspects)
    .innerJoin(contacts, eq(crmProspects.contactId, contacts.id))
    .leftJoin(events, eq(crmProspects.eventId, events.id))
    .orderBy(asc(crmProspects.sort), asc(crmProspects.id))
    .all();

  const notes = await db.select({ prospectId: crmProspectEvents.prospectId, kind: crmProspectEvents.kind }).from(crmProspectEvents).all();

  return rows.map((row) => ({
    id: row.id,
    contactId: row.contactId,
    name: `${row.firstName} ${row.lastName}`.trim() || row.email,
    email: row.email,
    title: row.title,
    company: row.company,
    stage: row.stage as CrmStage,
    score: row.score,
    rationale: row.rationale,
    eventId: row.eventId,
    eventName: row.eventName,
    noteCount: notes.filter((note) => note.prospectId === row.id && note.kind === "note").length,
    updatedAt: row.updatedAt,
  }));
}

export async function enrollProspect(input: {
  contactId: number;
  stage: CrmStage;
  score: number | null;
  rationale: string;
  eventId: number | null;
  author: { id: number | null; name: string };
}): Promise<number> {
  const db = getDb();
  const existing = await db.select({ id: crmProspects.id }).from(crmProspects).where(eq(crmProspects.contactId, input.contactId)).get();
  if (existing) return existing.id;

  const now = new Date();
  const created = await db
    .insert(crmProspects)
    .values({
      contactId: input.contactId,
      eventId: input.eventId,
      stage: input.stage,
      score: input.score,
      rationale: input.rationale || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: crmProspects.id })
    .get();

  await db.insert(crmProspectEvents).values({
    prospectId: created.id,
    kind: "enrolled",
    toStage: input.stage,
    body: input.rationale || null,
    authorUserId: input.author.id,
    authorName: input.author.name,
    createdAt: now,
  });
  return created.id;
}

export async function moveProspect(
  prospectId: number,
  stage: CrmStage,
  author: { id: number | null; name: string }
): Promise<boolean> {
  const db = getDb();
  const current = await db.select().from(crmProspects).where(eq(crmProspects.id, prospectId)).get();
  if (!current || current.stage === stage) return false;

  await db.update(crmProspects).set({ stage, updatedAt: new Date() }).where(eq(crmProspects.id, prospectId));
  await db.insert(crmProspectEvents).values({
    prospectId,
    kind: "stage",
    fromStage: current.stage,
    toStage: stage,
    authorUserId: author.id,
    authorName: author.name,
    createdAt: new Date(),
  });
  return true;
}

export async function addProspectNote(prospectId: number, body: string, author: { id: number | null; name: string }) {
  const db = getDb();
  await db.insert(crmProspectEvents).values({
    prospectId,
    kind: "note",
    body,
    authorUserId: author.id,
    authorName: author.name,
    createdAt: new Date(),
  });
  await db.update(crmProspects).set({ updatedAt: new Date() }).where(eq(crmProspects.id, prospectId));
}

export async function prospectDetail(prospectId: number) {
  const db = getDb();
  const cards = await listProspects();
  const card = cards.find((row) => row.id === prospectId);
  if (!card) return null;
  const history = await db
    .select()
    .from(crmProspectEvents)
    .where(eq(crmProspectEvents.prospectId, prospectId))
    .orderBy(desc(crmProspectEvents.createdAt), desc(crmProspectEvents.id))
    .all();
  return { card, history };
}

export async function removeProspect(prospectId: number) {
  const db = getDb();
  await db.delete(crmProspectEvents).where(eq(crmProspectEvents.prospectId, prospectId));
  await db.delete(crmProspects).where(eq(crmProspects.id, prospectId));
}

// ---------- Push into an event ----------

/** Adds contacts to an event's roster. This is the whole point of the CRM: the
 *  event gets the existing record, nobody re-keys a bio. */
export async function addContactsToEvent(eventId: number, contactIds: number[]): Promise<number> {
  const db = getDb();
  let added = 0;
  for (const contactId of contactIds) {
    const existing = await db
      .select({ id: eventContacts.id })
      .from(eventContacts)
      .where(and(eq(eventContacts.eventId, eventId), eq(eventContacts.contactId, contactId)))
      .get();
    if (existing) continue;
    await db.insert(eventContacts).values({ eventId, contactId, kind: "speaker", status: "invited" });
    added += 1;
  }
  return added;
}

// ---------- Merge ----------

export interface MergeCandidate {
  primary: CrmContactRow;
  duplicate: CrmContactRow;
}

/** Same normalized name, different record. */
export async function duplicateGroups(): Promise<CrmContactRow[][]> {
  const rows = await listContacts();
  const byName = new Map<string, CrmContactRow[]>();
  for (const row of rows) {
    const key = nameKey(row.firstName, row.lastName);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  return [...byName.values()].filter((group) => group.length > 1);
}

/** Moves every reference to the primary, applies the chosen field values, and
 *  deletes the loser. Not reversible, which the UI says out loud. */
export async function mergeContacts(
  primaryId: number,
  duplicateId: number,
  chosen: { firstName: string; lastName: string; email: string; title: string; company: string; bio: string }
): Promise<boolean> {
  if (primaryId === duplicateId) return false;
  const db = getDb();

  const primary = await db.select().from(contacts).where(eq(contacts.id, primaryId)).get();
  const duplicate = await db.select().from(contacts).where(eq(contacts.id, duplicateId)).get();
  if (!primary || !duplicate) return false;

  // Re-point everything the duplicate owns. Roster and session rows are unique per
  // (event, contact) and (session, contact), so an existing row wins and the
  // duplicate's is dropped rather than colliding.
  const links = await db.select().from(eventContacts).where(eq(eventContacts.contactId, duplicateId)).all();
  for (const link of links) {
    const clash = await db
      .select({ id: eventContacts.id })
      .from(eventContacts)
      .where(and(eq(eventContacts.eventId, link.eventId), eq(eventContacts.contactId, primaryId)))
      .get();
    if (clash) await db.delete(eventContacts).where(eq(eventContacts.id, link.id));
    else await db.update(eventContacts).set({ contactId: primaryId }).where(eq(eventContacts.id, link.id));
  }

  const parts = await db.select().from(sessionParticipants).where(eq(sessionParticipants.contactId, duplicateId)).all();
  for (const part of parts) {
    const clash = await db
      .select({ id: sessionParticipants.id })
      .from(sessionParticipants)
      .where(and(eq(sessionParticipants.sessionId, part.sessionId), eq(sessionParticipants.contactId, primaryId)))
      .get();
    if (clash) await db.delete(sessionParticipants).where(eq(sessionParticipants.id, part.id));
    else await db.update(sessionParticipants).set({ contactId: primaryId }).where(eq(sessionParticipants.id, part.id));
  }

  await db.update(crmNotes).set({ contactId: primaryId }).where(eq(crmNotes.contactId, duplicateId));
  await db.update(emailSends).set({ toContactId: primaryId }).where(eq(emailSends.toContactId, duplicateId));
  await db.update(sessions).set({ submittedBy: primaryId }).where(eq(sessions.submittedBy, duplicateId));

  // One pipeline card per contact: keep the primary's if it already has one.
  const dupProspect = await db.select().from(crmProspects).where(eq(crmProspects.contactId, duplicateId)).get();
  if (dupProspect) {
    const primaryProspect = await db.select().from(crmProspects).where(eq(crmProspects.contactId, primaryId)).get();
    if (primaryProspect) {
      await db
        .update(crmProspectEvents)
        .set({ prospectId: primaryProspect.id })
        .where(eq(crmProspectEvents.prospectId, dupProspect.id));
      await db.delete(crmProspects).where(eq(crmProspects.id, dupProspect.id));
    } else {
      await db.update(crmProspects).set({ contactId: primaryId }).where(eq(crmProspects.id, dupProspect.id));
    }
  }

  await db.delete(crmSegmentMembers).where(eq(crmSegmentMembers.contactId, duplicateId));

  const mergedTags = [
    ...new Set([...parseJson<string[]>(primary.tagsJson, []), ...parseJson<string[]>(duplicate.tagsJson, [])]),
  ];
  const mergedCustom = {
    ...parseJson<Record<string, string>>(duplicate.customJson, {}),
    ...parseJson<Record<string, string>>(primary.customJson, {}),
  };

  await db
    .update(contacts)
    .set({
      firstName: chosen.firstName,
      lastName: chosen.lastName,
      email: chosen.email.toLowerCase(),
      title: chosen.title || null,
      company: chosen.company || null,
      bio: chosen.bio || null,
      tagsJson: JSON.stringify(mergedTags),
      customJson: JSON.stringify(mergedCustom),
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, primaryId));

  await db.delete(contacts).where(eq(contacts.id, duplicateId));
  return true;
}

// ---------- Dashboard ----------

export interface CrmDashboard {
  totalContacts: number;
  totalEvents: number;
  returningSpeakers: number;
  inPipeline: number;
  withoutEvent: number;
  topCompanies: { name: string; count: number }[];
  topTitles: { name: string; count: number }[];
  byStage: { stage: CrmStage; count: number }[];
  recentContacts: { id: number; name: string; company: string | null; createdAt: Date }[];
}

export async function crmDashboard(): Promise<CrmDashboard> {
  const db = getDb();
  const rows = await listContacts();
  const eventRows = await db.select({ id: events.id }).from(events).all();

  const tally = (values: (string | null)[]) => {
    const counts = new Map<string, number>();
    for (const value of values) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 6);
  };

  return {
    totalContacts: rows.length,
    totalEvents: eventRows.length,
    // Someone who has worked on more than one of the org's events.
    returningSpeakers: rows.filter((row) => row.eventCount > 1).length,
    inPipeline: rows.filter((row) => row.stage != null).length,
    withoutEvent: rows.filter((row) => row.eventCount === 0).length,
    topCompanies: tally(rows.map((row) => row.company)),
    topTitles: tally(rows.map((row) => row.title)),
    byStage: CRM_STAGES.map((stage) => ({
      stage: stage.key,
      count: rows.filter((row) => row.stage === stage.key).length,
    })),
    recentContacts: [...rows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 6)
      .map((row) => ({ id: row.id, name: row.name, company: row.company, createdAt: row.createdAt })),
  };
}

export async function listEventsForPicker() {
  const db = getDb();
  return db
    .select({ id: events.id, name: events.name, status: events.status })
    .from(events)
    .orderBy(desc(events.createdAt))
    .all();
}

export async function contactsByIds(ids: number[]): Promise<CrmContactRow[]> {
  if (ids.length === 0) return [];
  const rows = await listContacts();
  return rows.filter((row) => ids.includes(row.id));
}

export async function deleteContact(contactId: number): Promise<void> {
  const db = getDb();
  await db.delete(crmNotes).where(eq(crmNotes.contactId, contactId));
  await db.delete(crmSegmentMembers).where(eq(crmSegmentMembers.contactId, contactId));
  const prospect = await db.select({ id: crmProspects.id }).from(crmProspects).where(eq(crmProspects.contactId, contactId)).get();
  if (prospect) await removeProspect(prospect.id);
  await db.delete(eventContacts).where(eq(eventContacts.contactId, contactId));
  await db.delete(sessionParticipants).where(eq(sessionParticipants.contactId, contactId));
  await db.delete(contacts).where(eq(contacts.id, contactId));
}

export async function contactIdsInSegment(segmentId: number): Promise<number[]> {
  const segment = await getSegment(segmentId);
  if (!segment) return [];
  if (segment.kind === "curated") return segment.memberIds;
  const rows = await listContacts({ segmentId });
  return rows.map((row) => row.id);
}

export async function inArrayContacts(ids: number[]) {
  const db = getDb();
  if (ids.length === 0) return [];
  return db.select().from(contacts).where(inArray(contacts.id, ids)).all();
}
