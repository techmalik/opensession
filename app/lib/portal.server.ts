// Everything the speaker portal is allowed to see, in one place. Scoping is not a
// filter applied per screen: every query here starts from the signed-in speaker's
// contact id, so a route cannot accidentally widen it.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./db.server";
import { requireUser, type CurrentUser } from "./session.server";
import { loadAudiences, resolveAudience, type Audience } from "./tasks.server";
import {
  contacts,
  eventContacts,
  events,
  fileRequests,
  fileUploads,
  portalTasks,
  rooms,
  sessionParticipants,
  sessions,
  statuses,
  taskCompletions,
  tracks,
} from "../../database/schema";

export interface SpeakerContext {
  user: CurrentUser;
  contactId: number;
}

/** A signed-in speaker with a contact record. Organizers and evaluators have no
 *  portal of their own, so they get a 403 rather than an empty one. */
export async function requireSpeaker(request: Request): Promise<SpeakerContext> {
  const user = await requireUser(request);
  if (user.contactId == null) {
    throw new Response("This area is for speakers. Your account has no speaker profile.", { status: 403 });
  }
  return { user, contactId: user.contactId };
}

export interface PortalEvent {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  location: string | null;
}

/** Events where this contact is on the roster or listed on a session. */
export async function myEvents(contactId: number): Promise<PortalEvent[]> {
  const db = getDb();
  const rosterIds = (
    await db
      .select({ eventId: eventContacts.eventId })
      .from(eventContacts)
      .where(eq(eventContacts.contactId, contactId))
      .all()
  ).map((r) => r.eventId);
  const sessionIds = (
    await db
      .select({ eventId: sessions.eventId })
      .from(sessionParticipants)
      .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
      .where(eq(sessionParticipants.contactId, contactId))
      .all()
  ).map((r) => r.eventId);

  const ids = [...new Set([...rosterIds, ...sessionIds])];
  if (ids.length === 0) return [];
  return db
    .select({ id: events.id, name: events.name, slug: events.slug, timezone: events.timezone, location: events.location })
    .from(events)
    .where(inArray(events.id, ids))
    .orderBy(asc(events.name))
    .all();
}

export interface PortalSession {
  id: number;
  friendlyId: string;
  title: string;
  eventId: number;
  eventName: string;
  eventTimezone: string;
  eventLocation: string | null;
  statusKey: string | null;
  isDraft: boolean;
  role: string;
  inviteStatus: "invited" | "confirmed" | "declined";
  participantId: number;
  roomName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  trackName: string | null;
}

export async function mySessions(contactId: number): Promise<PortalSession[]> {
  const db = getDb();
  return db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      eventId: sessions.eventId,
      eventName: events.name,
      eventTimezone: events.timezone,
      eventLocation: events.location,
      statusKey: statuses.key,
      isDraft: sessions.isDraft,
      role: sessionParticipants.role,
      inviteStatus: sessionParticipants.inviteStatus,
      participantId: sessionParticipants.id,
      roomName: rooms.name,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      trackName: tracks.name,
    })
    .from(sessionParticipants)
    .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
    .innerJoin(events, eq(sessions.eventId, events.id))
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .leftJoin(rooms, eq(sessions.roomId, rooms.id))
    .leftJoin(tracks, eq(sessions.trackId, tracks.id))
    .where(eq(sessionParticipants.contactId, contactId))
    .orderBy(asc(sessions.startsAt), desc(sessions.updatedAt))
    .all();
}

export interface PortalTask {
  id: number;
  eventId: number;
  eventName: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  timezone: string;
  done: boolean;
  completedAt: Date | null;
  overdue: boolean;
}

export async function myTasks(contactId: number, now = new Date()): Promise<PortalTask[]> {
  const db = getDb();
  const eventList = await myEvents(contactId);
  const result: PortalTask[] = [];

  for (const event of eventList) {
    const resolver = await loadAudiences(event.id);
    const rows = await db
      .select()
      .from(portalTasks)
      .where(eq(portalTasks.eventId, event.id))
      .orderBy(asc(portalTasks.sort), asc(portalTasks.id))
      .all();
    const mine = rows.filter((row) =>
      resolveAudience(resolver, row.appliesTo as Audience, resolver.taskSelected.get(row.id)).includes(contactId)
    );
    if (mine.length === 0) continue;

    const completions = await db
      .select()
      .from(taskCompletions)
      .where(and(inArray(taskCompletions.taskId, mine.map((t) => t.id)), eq(taskCompletions.contactId, contactId)))
      .all();

    for (const task of mine) {
      const completion = completions.find((c) => c.taskId === task.id);
      const done = completion?.status === "done";
      result.push({
        id: task.id,
        eventId: event.id,
        eventName: event.name,
        title: task.title,
        description: task.description,
        dueAt: task.dueAt,
        timezone: event.timezone,
        done,
        completedAt: completion?.completedAt ?? null,
        overdue: !done && task.dueAt != null && task.dueAt < now,
      });
    }
  }
  return result;
}

export interface PortalFileRequest {
  id: number;
  eventId: number;
  eventName: string;
  title: string;
  instructions: string | null;
  dueAt: Date | null;
  timezone: string;
  sampleBlobKey: string | null;
  sampleFilename: string | null;
  latestUploadId: number | null;
  latestFilename: string | null;
  latestVersion: number;
  approval: "pending" | "approved" | "denied" | null;
  versionCount: number;
  uploadedAt: Date | null;
  overdue: boolean;
}

export async function myFileRequests(contactId: number, now = new Date()): Promise<PortalFileRequest[]> {
  const db = getDb();
  const eventList = await myEvents(contactId);
  const result: PortalFileRequest[] = [];

  for (const event of eventList) {
    const resolver = await loadAudiences(event.id);
    const rows = await db
      .select()
      .from(fileRequests)
      .where(eq(fileRequests.eventId, event.id))
      .orderBy(asc(fileRequests.id))
      .all();
    const mine = rows.filter((row) =>
      resolveAudience(resolver, row.appliesTo as Audience, resolver.requestSelected.get(row.id)).includes(contactId)
    );
    if (mine.length === 0) continue;

    const uploads = await db
      .select()
      .from(fileUploads)
      .where(and(eq(fileUploads.eventId, event.id), eq(fileUploads.contactId, contactId)))
      .all();

    for (const request of mine) {
      const versions = uploads.filter((u) => u.requestId === request.id).sort((a, b) => b.version - a.version);
      const latest = versions[0];
      result.push({
        id: request.id,
        eventId: event.id,
        eventName: event.name,
        title: request.title,
        instructions: request.instructions,
        dueAt: request.dueAt,
        timezone: event.timezone,
        sampleBlobKey: request.sampleBlobKey,
        sampleFilename: request.sampleFilename,
        latestUploadId: latest?.id ?? null,
        latestFilename: latest?.filename ?? null,
        latestVersion: latest?.version ?? 0,
        approval: latest?.approval ?? null,
        versionCount: versions.length,
        uploadedAt: latest?.createdAt ?? null,
        overdue: !latest && request.dueAt != null && request.dueAt < now,
      });
    }
  }
  return result;
}

/** The file request as this speaker may see it, or null. Used by the detail page so
 *  a guessed request id from another event returns a 404, not someone else's data. */
export async function myFileRequest(contactId: number, requestId: number): Promise<PortalFileRequest | null> {
  const all = await myFileRequests(contactId);
  return all.find((request) => request.id === requestId) ?? null;
}

export async function myProfile(contactId: number) {
  const db = getDb();
  return db.select().from(contacts).where(eq(contacts.id, contactId)).get();
}

/** Upload limits, stated in the UI next to every file input (CNT-06). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const UPLOAD_ACCEPT =
  ".pdf,.ppt,.pptx,.key,.png,.jpg,.jpeg,.webp,.mp4,.mov,.zip,.doc,.docx,.txt,.md";
export const UPLOAD_HELP = "PDF, slides, images, video, or ZIP. Up to 20 MB per file.";

/** Saves one upload against a file request as the next version of that deliverable.
 *  Never overwrites: the previous version keeps its own row and blob. */
export async function saveSpeakerUpload(input: {
  contactId: number;
  userId: number;
  request: PortalFileRequest;
  file: File;
}): Promise<{ error: string } | { uploadId: number; version: number }> {
  const { contactId, userId, request, file } = input;
  if (file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "That file is larger than 20 MB." };

  const db = getDb();
  const { newBlobKey, putFile } = await import("./storage");
  const { bindings } = await import("./db.server");
  const { nextVersion } = await import("./content.server");

  // Attach the upload to one of this speaker's sessions in the same event, so the
  // organizer sees it on the session as well as on the request.
  const ownSession = await db
    .select({ id: sessions.id })
    .from(sessionParticipants)
    .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
    .where(and(eq(sessionParticipants.contactId, contactId), eq(sessions.eventId, request.eventId)))
    .orderBy(asc(sessions.id))
    .get();

  const key = newBlobKey(`request-${request.id}-contact-${contactId}`, file.name || "upload");
  await putFile(bindings, key, await file.arrayBuffer(), file.type || "application/octet-stream");
  const version = await nextVersion(request.eventId, request.id, contactId, ownSession?.id ?? null);

  const created = await db
    .insert(fileUploads)
    .values({
      requestId: request.id,
      eventId: request.eventId,
      contactId,
      sessionId: ownSession?.id ?? null,
      version,
      blobKey: key,
      filename: file.name || "upload",
      contentType: file.type || "application/octet-stream",
      size: file.size,
      // A new version always goes back to the review queue.
      approval: "pending",
      uploadedBy: userId,
      createdAt: new Date(),
    })
    .returning({ id: fileUploads.id })
    .get();

  return { uploadId: created.id, version };
}
