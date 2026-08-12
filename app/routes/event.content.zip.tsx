// Resource route: bulk download. One folder per file request, and at most one file
// per deliverable, because a deliverable is the pair (file request, speaker) and an
// AV team wants the current cut of each, not its history.

import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.content.zip";
import { bindings, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { queryUploads, groupKey, type UploadRow } from "../lib/content.server";
import { getFile } from "../lib/storage";
import { buildZip, zipPath, zipResponse } from "../lib/zip.server";
import { events, fileUploads } from "../../database/schema";

/** Refuses rather than dying halfway. A Worker that runs out of memory answers 503,
 *  which tells the organizer nothing; this tells them to narrow the export. */
const MAX_ARCHIVE_BYTES = 90 * 1024 * 1024;

/** Collapses versions: one row per deliverable, the newest of the rows given. Every
 *  caller passes rows it already decided are eligible, so this never reaches past
 *  what was asked for (a selection stays a selection). */
function latestPerDeliverable(rows: UploadRow[]): UploadRow[] {
  const best = new Map<string, UploadRow>();
  for (const row of rows) {
    const key = groupKey(row);
    const current = best.get(key);
    if (!current || row.version > current.version) best.set(key, row);
  }
  return [...best.values()];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select({ slug: events.slug }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const ids = new Set(
    (url.searchParams.get("ids") ?? "")
      .split(",")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0)
  );

  const rows = await queryUploads(eventId, {
    q: url.searchParams.get("q") ?? "",
    approval: url.searchParams.get("approval") ?? "",
    requestId: Number(url.searchParams.get("request") ?? 0) || undefined,
  });

  // With a selection, the export is exactly those rows, collapsed to the newest
  // selected version of each deliverable. Without one, it is the newest approved
  // version of every deliverable: the files cleared for use.
  const chosen =
    ids.size > 0
      ? latestPerDeliverable(rows.filter((row) => ids.has(row.id)))
      : latestPerDeliverable(rows.filter((row) => row.approval === "approved"));

  if (chosen.length === 0) {
    throw new Response("Nothing to export. Approve at least one file, or select rows first.", { status: 404 });
  }

  const entries = [];
  let bytes = 0;
  for (const row of chosen) {
    const upload = await db.select({ blobKey: fileUploads.blobKey }).from(fileUploads).where(eq(fileUploads.id, row.id)).get();
    if (!upload) continue;
    const file = await getFile(bindings, upload.blobKey);
    if (!file) continue;
    bytes += file.data.byteLength;
    if (bytes > MAX_ARCHIVE_BYTES) {
      throw new Response(
        "This export is too large to build in one archive. Filter by file request, or select fewer rows, and download in batches.",
        { status: 413 }
      );
    }
    entries.push({
      path: zipPath(row.requestTitle ?? "Other files", `${row.speakerName} v${row.version} ${row.filename}`),
      data: new Uint8Array(file.data),
    });
  }

  if (entries.length === 0) throw new Response("The selected files have no stored data.", { status: 404 });

  return zipResponse(`${event.slug}-files.zip`, buildZip(entries));
}
