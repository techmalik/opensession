// The evaluator dashboard: my queue, grouped by plan, with progress. Deliberately
// isolated from the organizer app: no admin navigation exists here, and the data is
// scoped to the signed-in user's own assignments.

import { Link } from "react-router";
import { asc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/review";
import { getDb } from "../lib/db.server";
import { requireUser } from "../lib/session.server";
import { getCriteria, reviewScore } from "../lib/evals.server";
import { formatDate, formatScore } from "../lib/format";
import { evalAssignments, evalPlans, evalScores, events, sessions } from "../../database/schema";
import { AppBar, Card, EmptyState } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Review | OpenSession" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const db = getDb();

  const rows = await db
    .select({
      id: evalAssignments.id,
      status: evalAssignments.status,
      planId: evalPlans.id,
      planName: evalPlans.name,
      round: evalPlans.round,
      planStatus: evalPlans.status,
      dueAt: evalPlans.dueAt,
      anonymized: evalPlans.anonymized,
      eventName: events.name,
      eventTimezone: events.timezone,
      sessionId: sessions.id,
      title: sessions.title,
      friendlyId: sessions.friendlyId,
      isDraft: sessions.isDraft,
    })
    .from(evalAssignments)
    .innerJoin(evalPlans, eq(evalAssignments.planId, evalPlans.id))
    .innerJoin(events, eq(evalPlans.eventId, events.id))
    .innerJoin(sessions, eq(evalAssignments.sessionId, sessions.id))
    .where(eq(evalAssignments.evaluatorUserId, user.id))
    .orderBy(asc(evalPlans.round), asc(evalAssignments.id))
    .all();

  // Drafts are never reviewable, even if assigned by mistake.
  const visible = rows.filter((row) => !row.isDraft);

  const doneIds = visible.filter((r) => r.status === "done").map((r) => r.id);
  const scoreRows =
    doneIds.length > 0
      ? await db
          .select({ assignmentId: evalScores.assignmentId, criterionId: evalScores.criterionId, score: evalScores.score })
          .from(evalScores)
          .where(inArray(evalScores.assignmentId, doneIds))
          .all()
      : [];

  const planIds = [...new Set(visible.map((r) => r.planId))];
  const criteriaByPlan = new Map<number, Map<number, { kind: string; weight: number }>>();
  for (const planId of planIds) {
    const criteria = await getCriteria(planId);
    criteriaByPlan.set(planId, new Map(criteria.map((c) => [c.id, { kind: c.kind, weight: c.weight }])));
  }

  return {
    user,
    assignments: visible.map((row) => ({
      ...row,
      myScore:
        row.status === "done"
          ? reviewScore(
              scoreRows.filter((s) => s.assignmentId === row.id).map((s) => ({ criterionId: s.criterionId, score: s.score })),
              criteriaByPlan.get(row.planId) ?? new Map()
            )
          : null,
    })),
  };
}

export default function Review({ loaderData }: Route.ComponentProps) {
  const { user, assignments } = loaderData;

  const byPlan = new Map<number, typeof assignments>();
  for (const assignment of assignments) {
    const list = byPlan.get(assignment.planId) ?? [];
    list.push(assignment);
    byPlan.set(assignment.planId, list);
  }

  const firstPending = assignments.find((a) => a.status === "pending" && a.planStatus === "active");
  for (const list of byPlan.values()) {
    list.sort((a, b) => Number(a.status === "recused") - Number(b.status === "recused"));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="OpenSession Review" userName={user.name} homeTo="/review" />

      <main className="mx-auto w-full max-w-[960px] px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Your review queue</h1>
            <p className="mt-1 text-sm text-slate-500">
              {assignments.length === 0
                ? "Nothing is assigned to you yet."
                : `${assignments.filter((a) => a.status === "done").length} of ${assignments.filter((a) => a.status !== "recused").length} reviews completed${
                    assignments.some((a) => a.status === "recused")
                      ? `, ${assignments.filter((a) => a.status === "recused").length} recused`
                      : ""
                  }.`}
            </p>
          </div>
          {firstPending ? (
            <Link
              to={`/review/${firstPending.id}`}
              className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Start reviewing
            </Link>
          ) : null}
        </div>

        {assignments.length === 0 ? (
          <Card className="mt-5">
            <EmptyState message="When an organizer assigns you submissions, they appear here." />
          </Card>
        ) : (
          [...byPlan.entries()].map(([planId, list]) => {
            const plan = list[0];
            const done = list.filter((a) => a.status === "done").length;
            return (
              <Card key={planId} className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      {plan.eventName}: {plan.planName}
                    </h2>
                    <p className="text-[13px] text-slate-500">
                      Round {plan.round}
                      {plan.dueAt ? `, due ${formatDate(plan.dueAt, plan.eventTimezone)}` : ""}
                      {plan.planStatus === "closed" ? ", closed" : ""}
                    </p>
                  </div>
                  <p className="text-[13px] tabular-nums text-slate-500">
                    {list.filter((a) => a.status !== "recused").length} assigned, {done} completed
                    {list.some((a) => a.status === "recused")
                      ? `, ${list.filter((a) => a.status === "recused").length} recused`
                      : ""}
                  </p>
                </div>
                <ul className="divide-y divide-slate-100">
                  {list.map((assignment) => (
                    <li key={assignment.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <Link to={`/review/${assignment.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-accent">
                          {assignment.title}
                        </Link>
                        <p className="font-mono text-xs text-slate-500">{assignment.friendlyId}</p>
                      </div>
                      {assignment.status === "done" ? (
                        <p className="flex items-center gap-2 text-[13px]">
                          <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                            Completed
                          </span>
                          {assignment.myScore != null ? (
                            <span className="tabular-nums text-slate-500">{formatScore(assignment.myScore)} / 5</span>
                          ) : null}
                          <Link to={`/review/${assignment.id}`} className="font-medium text-accent hover:underline">
                            Edit
                          </Link>
                        </p>
                      ) : assignment.status === "recused" ? (
                        <p className="flex items-center gap-2 text-[13px]">
                          <span className="inline-flex items-center gap-1.5 text-amber-700">
                            <span className="h-2 w-2 rounded-full bg-amber-600" aria-hidden="true" />
                            Recused, conflict of interest
                          </span>
                          <Link to={`/review/${assignment.id}`} className="font-medium text-slate-500 hover:text-slate-900">
                            Undo
                          </Link>
                        </p>
                      ) : (
                        <p className="flex items-center gap-2 text-[13px]">
                          <span className="inline-flex items-center gap-1.5 text-slate-500">
                            <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
                            Pending
                          </span>
                          <Link to={`/review/${assignment.id}`} className="font-medium text-accent hover:underline">
                            Review
                          </Link>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })
        )}
      </main>
    </div>
  );
}
