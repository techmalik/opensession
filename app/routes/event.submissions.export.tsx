// Resource route: CSV of the submissions table under the current filter, via the
// same query the table uses.

import type { Route } from "./+types/event.submissions.export";
import { requireOrganizer } from "../lib/session.server";
import { querySubmissions } from "../lib/submissions.server";
import { csvResponse, toCsv } from "../lib/format";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const url = new URL(request.url);

  const rows = await querySubmissions(eventId, {
    q: url.searchParams.get("q") ?? "",
    statusKey: url.searchParams.get("status") ?? "",
    trackId: Number(url.searchParams.get("track") ?? 0) || undefined,
    formatId: Number(url.searchParams.get("format") ?? 0) || undefined,
    publicState: url.searchParams.get("public") ?? "",
    sort: url.searchParams.get("sort") === "score" ? "score" : "submitted",
    dir: url.searchParams.get("dir") === "asc" ? "asc" : "desc",
  });

  const csv = toCsv(
    ["id", "title", "speakers", "track", "format", "status", "public_state", "score_avg", "score_count", "submitted_at", "decision_email_sent_at"],
    rows.map((row) => [
      row.friendlyId,
      row.title,
      row.speakers,
      row.trackName,
      row.formatName,
      row.statusLabel ?? "Pending",
      row.publicState,
      row.scoreAvg != null ? row.scoreAvg.toFixed(2) : "",
      row.scoreCount,
      row.submittedAt ? row.submittedAt.toISOString() : "",
      row.decisionEmailSentAt ? row.decisionEmailSentAt.toISOString() : "",
    ])
  );

  return csvResponse("submissions.csv", csv);
}
