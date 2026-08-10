// Who a portal task or file request applies to, and how far each speaker has got.
// Both entities share the same audience rules: everyone on the roster, only the
// speakers with an accepted session, or an explicit list.

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import type { Audience } from "./labels";
import {
  contacts,
  eventContacts,
  fileRequestAssignees,
  fileRequests,
  fileUploads,
  portalTasks,
  sessionParticipants,
  sessions,
  statuses,
  taskAssignees,
  taskCompletions,
} from "../../database/schema";

export type { Audience } from "./labels";

/** Every contact on this event's speaker roster. */
export async function rosterContactIds(eventId: number): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({ contactId: eventContacts.contactId })
    .from(eventContacts)
    .where(and(eq(eventContacts.eventId, eventId), eq(eventContacts.kind, "speaker")))
    .all();
  return [...new Set(rows.map((r) => r.contactId))];
}

/** Contacts listed on at least one accepted session for this event. */
export async function acceptedSpeakerContactIds(eventId: number): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({ contactId: sessionParticipants.contactId })
    .from(sessionParticipants)
    .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
    .innerJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(and(eq(sessions.eventId, eventId), eq(statuses.key, "accepted")))
    .all();
  return [...new Set(rows.map((r) => r.contactId))];
}

export interface AudienceResolver {
  roster: number[];
  accepted: Set<number>;
  taskSelected: Map<number, number[]>;
  requestSelected: Map<number, number[]>;
}

export async function loadAudiences(eventId: number): Promise<AudienceResolver> {
  const db = getDb();
  const roster = await rosterContactIds(eventId);
  const accepted = new Set(await acceptedSpeakerContactIds(eventId));

  const taskRows = await db
    .select({ taskId: taskAssignees.taskId, contactId: taskAssignees.contactId })
    .from(taskAssignees)
    .innerJoin(portalTasks, eq(taskAssignees.taskId, portalTasks.id))
    .where(eq(portalTasks.eventId, eventId))
    .all();
  const taskSelected = new Map<number, number[]>();
  for (const row of taskRows) taskSelected.set(row.taskId, [...(taskSelected.get(row.taskId) ?? []), row.contactId]);

  const requestRows = await db
    .select({ requestId: fileRequestAssignees.requestId, contactId: fileRequestAssignees.contactId })
    .from(fileRequestAssignees)
    .innerJoin(fileRequests, eq(fileRequestAssignees.requestId, fileRequests.id))
    .where(eq(fileRequests.eventId, eventId))
    .all();
  const requestSelected = new Map<number, number[]>();
  for (const row of requestRows)
    requestSelected.set(row.requestId, [...(requestSelected.get(row.requestId) ?? []), row.contactId]);

  return { roster, accepted, taskSelected, requestSelected };
}

export function resolveAudience(
  resolver: AudienceResolver,
  appliesTo: Audience,
  selected: number[] | undefined
): number[] {
  if (appliesTo === "selected") return selected ?? [];
  if (appliesTo === "accepted_speakers") return resolver.roster.filter((id) => resolver.accepted.has(id));
  return resolver.roster;
}

export interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  dueAt: Date | null;
  appliesTo: Audience;
  sort: number;
  assignees: number[];
}

export async function listTasks(eventId: number): Promise<TaskRow[]> {
  const db = getDb();
  const resolver = await loadAudiences(eventId);
  const rows = await db.select().from(portalTasks).where(eq(portalTasks.eventId, eventId)).all();
  return rows
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      dueAt: row.dueAt,
      appliesTo: row.appliesTo,
      sort: row.sort,
      assignees: resolveAudience(resolver, row.appliesTo, resolver.taskSelected.get(row.id)),
    }));
}

export interface FileRequestRow {
  id: number;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  appliesTo: Audience;
  sampleBlobKey: string | null;
  sampleFilename: string | null;
  assignees: number[];
}

export async function listFileRequests(eventId: number): Promise<FileRequestRow[]> {
  const db = getDb();
  const resolver = await loadAudiences(eventId);
  const rows = await db.select().from(fileRequests).where(eq(fileRequests.eventId, eventId)).all();
  return rows
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      title: row.title,
      instructions: row.instructions,
      dueAt: row.dueAt,
      appliesTo: row.appliesTo,
      sampleBlobKey: row.sampleBlobKey,
      sampleFilename: row.sampleFilename,
      assignees: resolveAudience(resolver, row.appliesTo, resolver.requestSelected.get(row.id)),
    }));
}

export interface SpeakerRef {
  contactId: number;
  name: string;
  email: string;
}

export async function listSpeakerRefs(eventId: number): Promise<SpeakerRef[]> {
  const db = getDb();
  const ids = await rosterContactIds(eventId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
    .from(contacts)
    .where(inArray(contacts.id, ids))
    .all();
  return rows
    .map((row) => ({
      contactId: row.id,
      name: `${row.firstName} ${row.lastName}`.trim() || row.email,
      email: row.email,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type CellStatus = "done" | "todo" | "overdue";

export interface MatrixCell {
  contactId: number;
  taskId: number;
  status: CellStatus;
  completedAt: Date | null;
}

/** Speakers x general tasks, with overdue derived from the due date. */
export async function taskMatrix(
  eventId: number,
  now = new Date()
): Promise<{ tasks: TaskRow[]; speakers: SpeakerRef[]; cells: MatrixCell[] }> {
  const db = getDb();
  const tasks = await listTasks(eventId);
  const speakers = await listSpeakerRefs(eventId);
  const taskIds = tasks.map((t) => t.id);
  const completions =
    taskIds.length > 0
      ? await db.select().from(taskCompletions).where(inArray(taskCompletions.taskId, taskIds)).all()
      : [];
  const doneKeys = new Map<string, Date | null>();
  for (const row of completions) {
    if (row.status === "done") doneKeys.set(`${row.taskId}:${row.contactId}`, row.completedAt);
  }

  const cells: MatrixCell[] = [];
  for (const task of tasks) {
    for (const contactId of task.assignees) {
      const key = `${task.id}:${contactId}`;
      const done = doneKeys.has(key);
      cells.push({
        contactId,
        taskId: task.id,
        status: done ? "done" : task.dueAt && task.dueAt < now ? "overdue" : "todo",
        completedAt: done ? (doneKeys.get(key) ?? null) : null,
      });
    }
  }
  return { tasks, speakers, cells };
}

export interface DeliverableCell {
  contactId: number;
  requestId: number;
  status: CellStatus;
  uploadId: number | null;
  approval: "pending" | "approved" | "denied" | null;
  version: number;
  filename: string | null;
  uploadedAt: Date | null;
}

/** Speakers x file requests, keyed on each speaker's latest upload for the request. */
export async function deliverableMatrix(
  eventId: number,
  now = new Date()
): Promise<{ requests: FileRequestRow[]; speakers: SpeakerRef[]; cells: DeliverableCell[] }> {
  const db = getDb();
  const requests = await listFileRequests(eventId);
  const speakers = await listSpeakerRefs(eventId);
  const uploads = await db
    .select()
    .from(fileUploads)
    .where(eq(fileUploads.eventId, eventId))
    .all();

  const latest = new Map<string, (typeof uploads)[number]>();
  for (const upload of uploads) {
    if (upload.requestId == null || upload.contactId == null) continue;
    const key = `${upload.requestId}:${upload.contactId}`;
    const current = latest.get(key);
    if (!current || upload.version > current.version) latest.set(key, upload);
  }

  const cells: DeliverableCell[] = [];
  for (const request of requests) {
    for (const contactId of request.assignees) {
      const upload = latest.get(`${request.id}:${contactId}`);
      cells.push({
        contactId,
        requestId: request.id,
        status: upload ? "done" : request.dueAt && request.dueAt < now ? "overdue" : "todo",
        uploadId: upload?.id ?? null,
        approval: upload?.approval ?? null,
        version: upload?.version ?? 0,
        filename: upload?.filename ?? null,
        uploadedAt: upload?.createdAt ?? null,
      });
    }
  }
  return { requests, speakers, cells };
}
