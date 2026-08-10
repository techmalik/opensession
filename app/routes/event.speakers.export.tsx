// Resource route: the speaker roster exactly as filtered on screen.

import type { Route } from "./+types/event.speakers.export";
import { requireOrganizer } from "../lib/session.server";
import { querySpeakers } from "../lib/speakers.server";
import { SPEAKER_STATUS_LABEL } from "../lib/labels";
import { csvResponse, toCsv } from "../lib/format";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const url = new URL(request.url);

  const rows = await querySpeakers(eventId, {
    q: url.searchParams.get("q") ?? "",
    status: url.searchParams.get("status") ?? "",
    flag: url.searchParams.get("flag") ?? "",
  });

  const body = toCsv(
    [
      "first_name",
      "last_name",
      "email",
      "title",
      "company",
      "status",
      "sessions",
      "accepted_sessions",
      "tasks_done",
      "tasks_total",
      "files_done",
      "files_total",
      "has_headshot",
      "bio",
    ],
    rows.map((row) => [
      row.firstName,
      row.lastName,
      row.email,
      row.title ?? "",
      row.company ?? "",
      SPEAKER_STATUS_LABEL[row.status],
      row.sessionTitles.join("; "),
      row.acceptedCount,
      row.tasksDone,
      row.tasksTotal,
      row.filesDone,
      row.filesTotal,
      row.headshotBlobKey ? "yes" : "no",
      row.bio ?? "",
    ])
  );

  return csvResponse("speakers.csv", body);
}
