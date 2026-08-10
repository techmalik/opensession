// Resource route: streams an uploaded file. Organizers can fetch anything; a speaker
// can fetch files on submissions they are part of, nothing else.

import { eq } from "drizzle-orm";
import type { Route } from "./+types/file.download";
import { bindings, getDb } from "../lib/db.server";
import { requireUser } from "../lib/session.server";
import { getFile } from "../lib/storage";
import { fileUploads, sessionParticipants } from "../../database/schema";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const uploadId = Number(params.uploadId);
  if (!Number.isInteger(uploadId)) throw new Response("Not found", { status: 404 });

  const db = getDb();
  const upload = await db.select().from(fileUploads).where(eq(fileUploads.id, uploadId)).get();
  if (!upload) throw new Response("Not found", { status: 404 });

  const isOrganizer = user.role === "admin" || user.role === "organizer";
  if (!isOrganizer) {
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
  }

  const file = await getFile(bindings, upload.blobKey);
  if (!file) throw new Response("File data missing", { status: 404 });

  // ?inline=1 renders the file in place (headshot thumbnails); the default is a
  // download, which is what every list-level link wants.
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return new Response(file.data, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${upload.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
