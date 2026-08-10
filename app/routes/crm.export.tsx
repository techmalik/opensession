// Resource route: the directory as CSV, under whatever filter is applied.

import type { Route } from "./+types/crm.export";
import { requireOrganizer } from "../lib/session.server";
import { listContacts } from "../lib/crm.server";
import { csvResponse, toCsv } from "../lib/format";

export async function loader({ request }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const url = new URL(request.url);

  const rows = await listContacts({
    q: url.searchParams.get("q") ?? "",
    company: url.searchParams.get("company") ?? "",
    title: url.searchParams.get("title") ?? "",
    tag: url.searchParams.get("tag") ?? "",
    stage: url.searchParams.get("stage") ?? "",
    hasEvent: url.searchParams.get("hasEvent") ?? "",
    segmentId: Number(url.searchParams.get("segment") ?? 0) || undefined,
  });

  const csv = toCsv(
    ["name", "email", "job_title", "company", "tags", "events", "sessions", "pipeline_stage", "added"],
    rows.map((row) => [
      row.name,
      row.email,
      row.title,
      row.company,
      row.tags.join(" "),
      row.eventCount,
      row.sessionCount,
      row.stage ?? "",
      row.createdAt.toISOString(),
    ])
  );

  return csvResponse("crm-contacts.csv", csv);
}
