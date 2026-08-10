// Resource route: the content review queue as CSV, filtered exactly as on screen.

import type { Route } from "./+types/event.content.export";
import { requireOrganizer } from "../lib/session.server";
import { queryUploads } from "../lib/content.server";
import { APPROVAL_LABEL } from "../lib/labels";
import { csvResponse, toCsv } from "../lib/format";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const url = new URL(request.url);

  const rows = await queryUploads(eventId, {
    q: url.searchParams.get("q") ?? "",
    approval: url.searchParams.get("approval") ?? "",
    requestId: Number(url.searchParams.get("request") ?? 0) || undefined,
    scope: url.searchParams.get("scope") ?? "",
  });

  const body = toCsv(
    ["filename", "request", "speaker", "email", "session", "version", "versions", "latest", "review", "size_bytes", "comments", "uploaded_at"],
    rows.map((row) => [
      row.filename,
      row.requestTitle ?? "",
      row.speakerName,
      row.speakerEmail,
      row.sessionTitle ?? "",
      row.version,
      row.versionCount,
      row.isLatest ? "yes" : "no",
      APPROVAL_LABEL[row.approval],
      row.size,
      row.commentCount,
      row.createdAt.toISOString(),
    ])
  );

  return csvResponse("content-review.csv", body);
}
