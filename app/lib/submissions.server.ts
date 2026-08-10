// One query behind the organizer submissions table and its CSV export, so the file
// you download is exactly the filter you were looking at.

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import { sessionScoreMap } from "./evals.server";
import { contacts, formats, sessionParticipants, sessions, statuses, tracks } from "../../database/schema";

export interface SubmissionFilters {
  q?: string;
  statusKey?: string;
  trackId?: number;
  formatId?: number;
  sort?: "submitted" | "score";
  dir?: "asc" | "desc";
}

export interface SubmissionListRow {
  id: number;
  friendlyId: string;
  title: string;
  isAbstract: boolean;
  statusId: number | null;
  statusKey: string | null;
  statusLabel: string | null;
  trackId: number | null;
  trackName: string | null;
  formatId: number | null;
  formatName: string | null;
  speakers: string;
  scoreAvg: number | null;
  scoreCount: number;
  submittedAt: Date | null;
  decisionEmailSentAt: Date | null;
}

export async function querySubmissions(eventId: number, filters: SubmissionFilters): Promise<SubmissionListRow[]> {
  const db = getDb();

  const rows = await db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      isAbstract: sessions.isAbstract,
      statusId: sessions.statusId,
      statusKey: statuses.key,
      statusLabel: statuses.label,
      trackId: sessions.trackId,
      trackName: tracks.name,
      formatId: sessions.formatId,
      formatName: formats.name,
      submittedAt: sessions.submittedAt,
      decisionEmailSentAt: sessions.decisionEmailSentAt,
    })
    .from(sessions)
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .leftJoin(formats, eq(sessions.formatId, formats.id))
    .where(and(eq(sessions.eventId, eventId), eq(sessions.isDraft, false)))
    .orderBy(desc(sessions.submittedAt), desc(sessions.id))
    .all();

  const ids = rows.map((r) => r.id);
  const speakerRows =
    ids.length > 0
      ? await db
          .select({
            sessionId: sessionParticipants.sessionId,
            sort: sessionParticipants.sort,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
          })
          .from(sessionParticipants)
          .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
          .where(inArray(sessionParticipants.sessionId, ids))
          .all()
      : [];
  const speakersBySession = new Map<number, string[]>();
  for (const row of speakerRows.sort((a, b) => a.sort - b.sort)) {
    const name = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
    if (!name) continue;
    const list = speakersBySession.get(row.sessionId) ?? [];
    list.push(name);
    speakersBySession.set(row.sessionId, list);
  }

  const scores = await sessionScoreMap(ids);

  let result = rows.map((row) => ({
    id: row.id,
    friendlyId: row.friendlyId,
    title: row.title,
    isAbstract: row.isAbstract,
    statusId: row.statusId,
    statusKey: row.statusKey,
    statusLabel: row.statusLabel,
    trackId: row.trackId,
    trackName: row.trackName,
    formatId: row.formatId,
    formatName: row.formatName,
    speakers: (speakersBySession.get(row.id) ?? []).join(", "),
    scoreAvg: scores.get(row.id)?.avg ?? null,
    scoreCount: scores.get(row.id)?.count ?? 0,
    submittedAt: row.submittedAt,
    decisionEmailSentAt: row.decisionEmailSentAt,
  }));

  const q = (filters.q ?? "").trim().toLowerCase();
  if (q) {
    result = result.filter(
      (row) =>
        row.title.toLowerCase().includes(q) ||
        row.friendlyId.toLowerCase().includes(q) ||
        row.speakers.toLowerCase().includes(q)
    );
  }
  if (filters.statusKey) result = result.filter((row) => row.statusKey === filters.statusKey);
  if (filters.trackId) result = result.filter((row) => row.trackId === filters.trackId);
  if (filters.formatId) result = result.filter((row) => row.formatId === filters.formatId);

  if (filters.sort === "score") {
    const dir = filters.dir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      const av = a.scoreAvg ?? -Infinity;
      const bv = b.scoreAvg ?? -Infinity;
      return av === bv ? 0 : av < bv ? -dir : dir;
    });
  } else if (filters.sort === "submitted" && filters.dir === "asc") {
    result.reverse();
  }

  return result;
}
