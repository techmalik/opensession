// Results for one evaluation plan: aggregate score per submission (weighted when the
// rubric carries weights), review counts, per-criterion averages, sortable by score.
// Per-evaluator detail lives on the submission page; this is the committee's ranking
// table.

import { Link, useSearchParams } from "react-router";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/event.plan.results";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { formatScore } from "../lib/format";
import { loadPlanResults } from "../lib/plan-results.server";
import { evalPlans, events } from "../../database/schema";
import { Breadcrumbs, Card, EmptyState, PageHeader, StatusBadge, buttonSecondary } from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.plan ? `Results | ${loaderData.plan.name}` : "Results" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const planId = Number(params.planId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const plan = await db
    .select({ id: evalPlans.id, name: evalPlans.name, round: evalPlans.round, scaleType: evalPlans.scaleType })
    .from(evalPlans)
    .where(and(eq(evalPlans.id, planId), eq(evalPlans.eventId, eventId)))
    .get();
  if (!plan) throw new Response("Plan not found", { status: 404 });

  const url = new URL(request.url);
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const { rows, criteria } = await loadPlanResults(eventId, planId, dir);

  return { event, plan, rows, criteria, dir };
}

export default function PlanResults({ loaderData, params }: Route.ComponentProps) {
  const { plan, rows, criteria, dir } = loaderData;
  const [searchParams] = useSearchParams();
  const numericCriteria = criteria.filter((c) => c.kind === "numeric");

  return (
    <>
      <Breadcrumbs items={[
          { to: `/admin/${params.eventId}/evaluations`, label: "Evaluations" },
          { to: `/admin/${params.eventId}/evaluations/${plan.id}`, label: plan.name },
          { label: "Results" },
        ]} />

      <PageHeader
        title="Results"
        description={`${plan.name}, round ${plan.round}. Aggregates are ${
          numericCriteria.some((c) => c.weight > 1) ? "weighted by criterion weight" : "plain averages"
        }.`}
        actions={
          <a href={`/admin/${params.eventId}/evaluations/${plan.id}/results.csv?${searchParams.toString()}`} className={buttonSecondary}>
            Export CSV
          </a>
        }
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState message="No completed reviews in this plan yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th scope="col" className="px-4 py-2 font-medium">Submission</th>
                  <th scope="col" className="px-3 py-2 font-medium">Track</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Reviews</th>
                  {numericCriteria.map((criterion) => (
                    <th scope="col" key={criterion.id} className="px-3 py-2 text-right font-medium">
                      {criterion.label}
                      {criterion.weight > 1 ? ` (x${criterion.weight})` : ""}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-medium">Recused</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    <Link to={`?dir=${dir === "desc" ? "asc" : "desc"}`} className="hover:text-slate-900">
                      Avg score {dir === "desc" ? "v" : "^"}
                    </Link>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.sessionId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="h-10 max-w-[360px] px-4">
                      <Link
                        to={`/admin/${params.eventId}/submissions/${row.sessionId}`}
                        className="block truncate font-medium text-slate-900 hover:text-accent"
                      >
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-3 text-slate-500">{row.trackName ?? ""}</td>
                    <td className="px-3">
                      <StatusBadge statusKey={row.statusKey ?? "pending"} label={row.statusLabel ?? "Pending"} />
                    </td>
                    <td className="px-3 text-right tabular-nums text-slate-900">{row.reviewCount}</td>
                    {numericCriteria.map((criterion) => (
                      <td key={criterion.id} className="px-3 text-right tabular-nums text-slate-900">
                        {row.criterionAvgs[criterion.id] != null ? formatScore(row.criterionAvgs[criterion.id]) : ""}
                      </td>
                    ))}
                    <td className="max-w-[180px] px-3">
                      {row.recusedBy.length === 0 ? (
                        <span className="text-slate-400">-</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-amber-700" title={row.recusedBy.join(", ")}>
                          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-600" aria-hidden="true" />
                          <span className="truncate">{row.recusedBy.join(", ")}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 text-right font-medium tabular-nums text-slate-900">
                      {row.avg != null ? formatScore(row.avg) : <span className="font-normal text-slate-400">no score</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-3 text-[13px] text-slate-500">
        Click a submission for the per-evaluator breakdown with comments.
      </p>
    </>
  );
}
