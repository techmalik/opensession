// Resource route: CSV of a plan's results table, one row per reviewed submission.

import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/event.plan.results.export";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { loadPlanResults } from "../lib/plan-results.server";
import { csvResponse, toCsv } from "../lib/format";
import { evalPlans } from "../../database/schema";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const planId = Number(params.planId);

  const db = getDb();
  const plan = await db
    .select({ id: evalPlans.id, name: evalPlans.name })
    .from(evalPlans)
    .where(and(eq(evalPlans.id, planId), eq(evalPlans.eventId, eventId)))
    .get();
  if (!plan) throw new Response("Plan not found", { status: 404 });

  const url = new URL(request.url);
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const { rows, criteria } = await loadPlanResults(eventId, planId, dir);
  const numericCriteria = criteria.filter((c) => c.kind === "numeric");

  const csv = toCsv(
    [
      "id",
      "title",
      "track",
      "status",
      "reviews",
      ...numericCriteria.map((c) => `${c.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_avg`),
      "avg_score",
    ],
    rows.map((row) => [
      row.friendlyId,
      row.title,
      row.trackName,
      row.statusLabel ?? "Pending",
      row.reviewCount,
      ...numericCriteria.map((c) => (row.criterionAvgs[c.id] != null ? row.criterionAvgs[c.id].toFixed(2) : "")),
      row.avg != null ? row.avg.toFixed(2) : "",
    ])
  );

  return csvResponse(`results-${plan.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, csv);
}
