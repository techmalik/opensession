// Public headshot for a speaker on this event's published program. Signed-in file
// downloads live at /files/:uploadId; this route exists so widgets can show a photo
// to an anonymous visitor without exposing anything else in the blob store.

import type { Route } from "./+types/embed.headshot";
import { eq } from "drizzle-orm";
import { bindings, getDb } from "../lib/db.server";
import { loadPublicData } from "../lib/public.server";
import { getFile } from "../lib/storage";
import { contacts } from "../../database/schema";

export async function loader({ params }: Route.LoaderArgs) {
  const contactId = Number(params.contactId);
  if (!Number.isInteger(contactId)) throw new Response("Not found", { status: 404 });

  // Only people who actually appear on the public program are readable here.
  const all = await loadPublicData(String(params.eventSlug));
  if (!all.speakers.some((speaker) => speaker.contactId === contactId)) {
    throw new Response("Not found", { status: 404 });
  }

  const db = getDb();
  const contact = await db
    .select({ key: contacts.headshotBlobKey })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .get();
  if (!contact?.key) throw new Response("Not found", { status: 404 });

  const file = await getFile(bindings, contact.key);
  if (!file) throw new Response("Not found", { status: 404 });

  return new Response(file.data, {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "public, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
