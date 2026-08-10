// CNT-11: version history for a session's title and abstract.
//
// A revision row holds the values as they stood after that change, so restoring is
// a write-back plus a new row: history is append-only and a restore is itself an
// auditable edit. The first edit backfills a "Submitted" row for the original text,
// so the version a speaker actually sent is never lost behind the first save.

import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { sessionRevisions, sessions } from "../../database/schema";

export interface RevisionRow {
  id: number;
  version: number;
  title: string;
  abstract: string;
  editorName: string;
  note: string;
  createdAt: Date;
  isCurrent: boolean;
}

export interface Editor {
  id: number | null;
  name: string;
}

/** Appends a version. Call this AFTER the session row is written, with the values
 *  that were just saved. */
export async function recordRevision(
  sessionId: number,
  values: { title: string; abstract: string | null },
  editor: Editor,
  note = "Edited"
): Promise<void> {
  const db = getDb();
  await db.insert(sessionRevisions).values({
    sessionId,
    title: values.title,
    abstract: values.abstract,
    editorUserId: editor.id,
    editorName: editor.name,
    note,
    createdAt: new Date(),
  });
}

/** Writes the pre-edit text as version 1 the first time a session is edited, so the
 *  history always starts from what was submitted. No-op once history exists. */
export async function ensureBaseRevision(
  sessionId: number,
  current: { title: string; abstract: string | null; submittedAt: Date | null; createdAt: Date },
  submitterName: string
): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: sessionRevisions.id })
    .from(sessionRevisions)
    .where(eq(sessionRevisions.sessionId, sessionId))
    .limit(1)
    .get();
  if (existing) return;

  await db.insert(sessionRevisions).values({
    sessionId,
    title: current.title,
    abstract: current.abstract,
    editorUserId: null,
    editorName: submitterName,
    note: "Submitted",
    createdAt: current.submittedAt ?? current.createdAt,
  });
}

/** Newest first, numbered oldest-to-newest so "version 3" means the same thing to
 *  everyone reading the panel. */
export async function listRevisions(sessionId: number): Promise<RevisionRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(sessionRevisions)
    .where(eq(sessionRevisions.sessionId, sessionId))
    .orderBy(asc(sessionRevisions.createdAt), asc(sessionRevisions.id))
    .all();

  return rows
    .map((row, index) => ({
      id: row.id,
      version: index + 1,
      title: row.title,
      abstract: row.abstract ?? "",
      editorName: row.editorName,
      note: row.note,
      createdAt: row.createdAt,
      isCurrent: index === rows.length - 1,
    }))
    .reverse();
}

/** Puts an earlier version back on the session and records the restore as its own
 *  version. Returns the restored title, or null if the revision is not this
 *  session's. */
export async function restoreRevision(
  eventId: number,
  sessionId: number,
  revisionId: number,
  editor: Editor
): Promise<{ title: string; version: number } | null> {
  const db = getDb();
  const session = await db
    .select({ id: sessions.id, answersJson: sessions.answersJson })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)))
    .get();
  if (!session) return null;

  const all = await db
    .select()
    .from(sessionRevisions)
    .where(eq(sessionRevisions.sessionId, sessionId))
    .orderBy(asc(sessionRevisions.createdAt), asc(sessionRevisions.id))
    .all();
  const index = all.findIndex((row) => row.id === revisionId);
  if (index === -1) return null;
  const target = all[index];

  // The answers blob carries its own copies of both fields; they move together or
  // the portal and the widgets disagree with the admin.
  let answers: Record<string, string> = {};
  try {
    const parsed = JSON.parse(session.answersJson);
    if (parsed && typeof parsed === "object") answers = parsed as Record<string, string>;
  } catch {
    answers = {};
  }
  if ("title" in answers) answers.title = target.title;
  if ("abstract" in answers) answers.abstract = target.abstract ?? "";

  await db
    .update(sessions)
    .set({
      title: target.title,
      abstract: target.abstract,
      answersJson: JSON.stringify(answers),
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));

  await recordRevision(
    sessionId,
    { title: target.title, abstract: target.abstract },
    editor,
    `Restored version ${index + 1}`
  );

  return { title: target.title, version: index + 1 };
}

/** Most recent editor and time, for the submissions table and the activity card. */
export async function lastEdit(sessionId: number): Promise<{ editorName: string; at: Date } | null> {
  const db = getDb();
  const row = await db
    .select({ editorName: sessionRevisions.editorName, createdAt: sessionRevisions.createdAt })
    .from(sessionRevisions)
    .where(eq(sessionRevisions.sessionId, sessionId))
    .orderBy(desc(sessionRevisions.createdAt), desc(sessionRevisions.id))
    .limit(1)
    .get();
  return row ? { editorName: row.editorName, at: row.createdAt } : null;
}
