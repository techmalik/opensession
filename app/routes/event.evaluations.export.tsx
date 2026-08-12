// Resource route: CSV of the evaluation plans list under the current filter.

import { asc, eq, sql } from "drizzle-orm";
import type { Route } from "./+types/event.evaluations.export";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { csvResponse, toCsv } from "../lib/format";
import { evalPlans } from "../../database/schema";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const status = url.searchParams.get("status") ?? "";

  const db = getDb();
  const rows = await db
    .select({
      id: evalPlans.id,
      name: evalPlans.name,
      round: evalPlans.round,
      blind: evalPlans.blind,
      anonymized: evalPlans.anonymized,
      scaleType: evalPlans.scaleType,
      maxEvals: evalPlans.maxEvalsPerSubmission,
      dueAt: evalPlans.dueAt,
      status: evalPlans.status,
      // See event.evaluations.tsx: an unqualified ${evalPlans.id} inside a subquery
      // on a table that also has its own "id" column resolves to that table's id
      // (Drizzle/D1 quirk), so the reference is qualified explicitly here.
      reviewerCount: sql<number>`(select count(*) from eval_plan_reviewers where eval_plan_reviewers.plan_id = ${sql.raw('"eval_plans"."id"')})`,
      assignmentCount: sql<number>`(select count(*) from eval_assignments where eval_assignments.plan_id = ${sql.raw('"eval_plans"."id"')})`,
      doneCount: sql<number>`(select count(*) from eval_assignments where eval_assignments.plan_id = ${sql.raw('"eval_plans"."id"')} and eval_assignments.status = 'done')`,
    })
    .from(evalPlans)
    .where(eq(evalPlans.eventId, eventId))
    .orderBy(asc(evalPlans.round), asc(evalPlans.id))
    .all();

  const filtered = rows.filter((row) => (!q || row.name.toLowerCase().includes(q)) && (!status || row.status === status));

  const csv = toCsv(
    ["id", "name", "round", "scale", "blind", "anonymized", "max_evals_per_submission", "due_at", "status", "reviewers", "assignments", "done"],
    filtered.map((r) => [
      r.id,
      r.name,
      r.round,
      r.scaleType,
      r.blind ? "yes" : "no",
      r.anonymized ? "yes" : "no",
      r.maxEvals,
      r.dueAt ? r.dueAt.toISOString() : "",
      r.status,
      r.reviewerCount,
      r.assignmentCount,
      r.doneCount,
    ])
  );

  return csvResponse("evaluation-plans.csv", csv);
}
