// Resource route: CSV of the forms list under the current filter.

import { asc, eq, sql } from "drizzle-orm";
import type { Route } from "./+types/event.forms.export";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { csvResponse, toCsv } from "../lib/format";
import { forms } from "../../database/schema";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const status = url.searchParams.get("status") ?? "";

  const db = getDb();
  const rows = await db
    .select({
      id: forms.id,
      name: forms.name,
      slug: forms.slug,
      status: forms.status,
      opensAt: forms.opensAt,
      closesAt: forms.closesAt,
      submissionLimit: forms.submissionLimit,
      maxSpeakers: forms.maxSpeakers,
      submissionCount: sql<number>`(
        select count(*) from sessions where sessions.form_id = ${forms.id} and sessions.is_draft = 0
      )`,
    })
    .from(forms)
    .where(eq(forms.eventId, eventId))
    .orderBy(asc(forms.createdAt))
    .all();

  const filtered = rows.filter(
    (row) => (!q || row.name.toLowerCase().includes(q)) && (!status || row.status === status)
  );

  const csv = toCsv(
    ["id", "name", "slug", "status", "opens_at", "closes_at", "submission_limit", "max_speakers", "submissions"],
    filtered.map((r) => [
      r.id,
      r.name,
      r.slug,
      r.status,
      r.opensAt ? r.opensAt.toISOString() : "",
      r.closesAt ? r.closesAt.toISOString() : "",
      r.submissionLimit,
      r.maxSpeakers,
      r.submissionCount,
    ])
  );

  return csvResponse("forms.csv", csv);
}
