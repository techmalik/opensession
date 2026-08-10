// Uploads, their versions, and their review state. A "deliverable" is the pair
// (file request, speaker): every upload against that pair is a version of the same
// thing, so re-uploading never overwrites and the whole history stays listed.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import type { Approval } from "./labels";
import { contacts, fileComments, fileRequests, fileUploads, sessions, users } from "../../database/schema";

export type { Approval } from "./labels";

export interface UploadRow {
  id: number;
  requestId: number | null;
  requestTitle: string | null;
  contactId: number | null;
  speakerName: string;
  speakerEmail: string;
  sessionId: number | null;
  sessionTitle: string | null;
  version: number;
  versionCount: number;
  isLatest: boolean;
  filename: string;
  contentType: string;
  size: number;
  approval: Approval;
  reviewedAt: Date | null;
  commentCount: number;
  createdAt: Date;
}

export interface UploadFilters {
  q?: string;
  requestId?: number;
  approval?: string;
  /** latest = only the newest version of each deliverable */
  scope?: string;
}

/** Deliverable identity: one file request per speaker, or an ad hoc session attachment. */
export function groupKey(row: { requestId: number | null; contactId: number | null; sessionId: number | null }): string {
  return row.requestId != null ? `r${row.requestId}:c${row.contactId ?? 0}` : `s${row.sessionId ?? 0}:c${row.contactId ?? 0}`;
}

export async function queryUploads(eventId: number, filters: UploadFilters = {}): Promise<UploadRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: fileUploads.id,
      requestId: fileUploads.requestId,
      requestTitle: fileRequests.title,
      contactId: fileUploads.contactId,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      sessionId: fileUploads.sessionId,
      sessionTitle: sessions.title,
      version: fileUploads.version,
      filename: fileUploads.filename,
      contentType: fileUploads.contentType,
      size: fileUploads.size,
      approval: fileUploads.approval,
      reviewedAt: fileUploads.reviewedAt,
      createdAt: fileUploads.createdAt,
    })
    .from(fileUploads)
    .leftJoin(fileRequests, eq(fileUploads.requestId, fileRequests.id))
    .leftJoin(contacts, eq(fileUploads.contactId, contacts.id))
    .leftJoin(sessions, eq(fileUploads.sessionId, sessions.id))
    .where(eq(fileUploads.eventId, eventId))
    .orderBy(desc(fileUploads.createdAt), desc(fileUploads.id))
    .all();

  const ids = rows.map((r) => r.id);
  const comments =
    ids.length > 0
      ? await db
          .select({ uploadId: fileComments.uploadId })
          .from(fileComments)
          .where(inArray(fileComments.uploadId, ids))
          .all()
      : [];
  const commentCount = new Map<number, number>();
  for (const row of comments) commentCount.set(row.uploadId, (commentCount.get(row.uploadId) ?? 0) + 1);

  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = groupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row.version]);
  }

  let result: UploadRow[] = rows.map((row) => {
    const key = groupKey(row);
    const versions = groups.get(key) ?? [row.version];
    return {
      id: row.id,
      requestId: row.requestId,
      requestTitle: row.requestTitle,
      contactId: row.contactId,
      speakerName: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.email || "Unknown",
      speakerEmail: row.email ?? "",
      sessionId: row.sessionId,
      sessionTitle: row.sessionTitle,
      version: row.version,
      versionCount: versions.length,
      isLatest: row.version === Math.max(...versions),
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
      approval: row.approval,
      reviewedAt: row.reviewedAt,
      commentCount: commentCount.get(row.id) ?? 0,
      createdAt: row.createdAt,
    };
  });

  const q = (filters.q ?? "").trim().toLowerCase();
  if (q) {
    result = result.filter(
      (row) =>
        row.filename.toLowerCase().includes(q) ||
        row.speakerName.toLowerCase().includes(q) ||
        (row.requestTitle ?? "").toLowerCase().includes(q) ||
        (row.sessionTitle ?? "").toLowerCase().includes(q)
    );
  }
  if (filters.requestId) result = result.filter((row) => row.requestId === filters.requestId);
  if (filters.approval) result = result.filter((row) => row.approval === filters.approval);
  if (filters.scope === "latest") result = result.filter((row) => row.isLatest);

  return result;
}

export interface CommentRow {
  id: number;
  body: string;
  authorName: string;
  authorRole: string;
  createdAt: Date;
}

export interface UploadDetail {
  upload: UploadRow;
  versions: UploadRow[];
  comments: CommentRow[];
  request: { id: number; title: string; instructions: string | null; dueAt: Date | null } | null;
}

export async function loadUploadDetail(eventId: number, uploadId: number): Promise<UploadDetail | null> {
  const db = getDb();
  const all = await queryUploads(eventId);
  const upload = all.find((row) => row.id === uploadId);
  if (!upload) return null;

  const key = groupKey(upload);
  const versions = all.filter((row) => groupKey(row) === key).sort((a, b) => b.version - a.version);

  const commentRows = await db
    .select({
      id: fileComments.id,
      body: fileComments.body,
      createdAt: fileComments.createdAt,
      authorName: users.name,
      authorRole: users.role,
      uploadId: fileComments.uploadId,
    })
    .from(fileComments)
    .leftJoin(users, eq(fileComments.authorUserId, users.id))
    .where(inArray(fileComments.uploadId, versions.map((v) => v.id)))
    .orderBy(asc(fileComments.createdAt))
    .all();

  const request =
    upload.requestId != null
      ? ((await db
          .select({
            id: fileRequests.id,
            title: fileRequests.title,
            instructions: fileRequests.instructions,
            dueAt: fileRequests.dueAt,
          })
          .from(fileRequests)
          .where(eq(fileRequests.id, upload.requestId))
          .get()) ?? null)
      : null;

  return {
    upload,
    versions,
    comments: commentRows.map((row) => ({
      id: row.id,
      body: row.body,
      authorName: row.authorName ?? "Unknown",
      authorRole: row.authorRole ?? "",
      createdAt: row.createdAt,
    })),
    request,
  };
}

/** Next version number for a deliverable. Version 1 is the first upload. */
export async function nextVersion(eventId: number, requestId: number | null, contactId: number, sessionId: number | null): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ version: fileUploads.version, requestId: fileUploads.requestId, sessionId: fileUploads.sessionId })
    .from(fileUploads)
    .where(and(eq(fileUploads.eventId, eventId), eq(fileUploads.contactId, contactId)))
    .all();
  const same = rows.filter((row) =>
    requestId != null ? row.requestId === requestId : row.requestId == null && row.sessionId === sessionId
  );
  return same.reduce((max, row) => Math.max(max, row.version), 0) + 1;
}

/** Every version of the deliverable a speaker owns for one request. */
export async function speakerVersions(eventId: number, requestId: number, contactId: number) {
  const db = getDb();
  return db
    .select()
    .from(fileUploads)
    .where(
      and(eq(fileUploads.eventId, eventId), eq(fileUploads.requestId, requestId), eq(fileUploads.contactId, contactId))
    )
    .orderBy(desc(fileUploads.version))
    .all();
}
