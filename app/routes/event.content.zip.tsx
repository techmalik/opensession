// Resource route: bulk download. Only the latest approved version of each
// deliverable, one folder per file request, so an AV team gets exactly the files
// they are allowed to use.

import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.content.zip";
import { bindings, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { queryUploads, groupKey } from "../lib/content.server";
import { getFile } from "../lib/storage";
import { buildZip, zipPath, zipResponse } from "../lib/zip.server";
import { events, fileUploads } from "../../database/schema";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select({ slug: events.slug }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);

  const rows = await queryUploads(eventId, {
    q: url.searchParams.get("q") ?? "",
    approval: url.searchParams.get("approval") ?? "",
    requestId: Number(url.searchParams.get("request") ?? 0) || undefined,
  });

  // A selection is taken as-is; without one, the export is the latest approved
  // version of every deliverable.
  const chosen =
    ids.length > 0
      ? rows.filter((row) => ids.includes(row.id))
      : (() => {
          const best = new Map<string, (typeof rows)[number]>();
          for (const row of rows) {
            if (row.approval !== "approved") continue;
            const key = groupKey(row);
            const current = best.get(key);
            if (!current || row.version > current.version) best.set(key, row);
          }
          return [...best.values()];
        })();

  if (chosen.length === 0) {
    throw new Response("Nothing to export. Approve at least one file, or select rows first.", { status: 404 });
  }

  const entries = [];
  for (const row of chosen) {
    const upload = await db.select({ blobKey: fileUploads.blobKey }).from(fileUploads).where(eq(fileUploads.id, row.id)).get();
    if (!upload) continue;
    const file = await getFile(bindings, upload.blobKey);
    if (!file) continue;
    entries.push({
      path: zipPath(row.requestTitle ?? "Other files", `${row.speakerName} v${row.version} ${row.filename}`),
      data: new Uint8Array(file.data),
    });
  }

  if (entries.length === 0) throw new Response("The selected files have no stored data.", { status: 404 });

  return zipResponse(`${event.slug}-files.zip`, buildZip(entries));
}
