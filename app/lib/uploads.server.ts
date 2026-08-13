// Who may read an uploaded file. Shared by /files/:uploadId and its image sibling so
// the two routes cannot drift apart on access.

import { eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { canAccessEvent } from "./events.server";
import { requireUser } from "./session.server";
import { events, fileUploads, sessionParticipants } from "../../database/schema";

/** The upload row this request is allowed to read, or a 404 for everything else.
 *
 *  Organizer reach is per event, exactly as it is in the admin UI: without that an
 *  organizer could walk numeric upload ids straight into another organizer's event.
 *  A speaker reaches their own files and the files on sessions they are on. */
export async function authorizedUpload(request: Request, uploadIdRaw: string | undefined) {
  const user = await requireUser(request);
  const uploadId = Number(uploadIdRaw);
  if (!Number.isInteger(uploadId)) throw new Response("Not found", { status: 404 });

  const db = getDb();
  const upload = await db.select().from(fileUploads).where(eq(fileUploads.id, uploadId)).get();
  if (!upload) throw new Response("Not found", { status: 404 });

  if (user.role === "admin" || user.role === "organizer") {
    const event = await db
      .select({ slug: events.slug, createdBy: events.createdBy })
      .from(events)
      .where(eq(events.id, upload.eventId))
      .get();
    if (!event || !canAccessEvent(user, event)) throw new Response("Not found", { status: 404 });
    return upload;
  }

  let allowed = upload.contactId != null && upload.contactId === user.contactId;
  if (!allowed && upload.sessionId != null && user.contactId != null) {
    const participants = await db
      .select({ contactId: sessionParticipants.contactId })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, upload.sessionId))
      .all();
    allowed = participants.some((p) => p.contactId === user.contactId);
  }
  if (!allowed) throw new Response("Not found", { status: 404 });
  return upload;
}
