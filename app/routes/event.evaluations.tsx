// Evaluation plans: one plan per review round, each with its own scorecard,
// anonymization, reviewer pool, and assignments.

import { useState } from "react";
import { Form, Link, redirect, useSearchParams } from "react-router";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Route } from "./+types/event.evaluations";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { formatDate, fromDateInputValue } from "../lib/format";
import { evalPlans, events } from "../../database/schema";
import { Badge, Card, EmptyState, Field, PageHeader, buttonPrimary, buttonSecondary, inputClass,
  inputSized, selectClass,
  selectSized } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Evaluations" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db
    .select({ name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const status = url.searchParams.get("status") ?? "";

  const rows = await db
    .select({
      id: evalPlans.id,
      name: evalPlans.name,
      round: evalPlans.round,
      blind: evalPlans.blind,
      anonymized: evalPlans.anonymized,
      scaleType: evalPlans.scaleType,
      dueAt: evalPlans.dueAt,
      status: evalPlans.status,
      reviewerCount: sql<number>`(
        select count(*) from eval_plan_reviewers where eval_plan_reviewers.plan_id = ${evalPlans.id}
      )`,
      assignmentCount: sql<number>`(
        select count(*) from eval_assignments where eval_assignments.plan_id = ${evalPlans.id}
      )`,
      doneCount: sql<number>`(
        select count(*) from eval_assignments where eval_assignments.plan_id = ${evalPlans.id} and eval_assignments.status = 'done'
      )`,
    })
    .from(evalPlans)
    .where(eq(evalPlans.eventId, eventId))
    .orderBy(asc(evalPlans.round), asc(evalPlans.id))
    .all();

  const filtered = rows.filter((row) => (!q || row.name.toLowerCase().includes(q)) && (!status || row.status === status));

  return { event, plans: filtered, total: rows.length };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { error: "Enter a plan name." };
    const round = Math.max(1, Number(form.get("round") ?? 1) || 1);
    const scaleType = String(form.get("scaleType") ?? "stars5") === "rubric" ? "rubric" : "stars5";
    const maxEvalsRaw = String(form.get("maxEvals") ?? "").trim();
    const dueDay = fromDateInputValue(form.get("dueAt"));

    const created = await db
      .insert(evalPlans)
      .values({
        eventId,
        name,
        round,
        blind: form.get("blind") === "on",
        anonymized: form.get("anonymized") === "on",
        scaleType,
        maxEvalsPerSubmission: maxEvalsRaw ? Math.max(1, Number(maxEvalsRaw) || 1) : null,
        dueAt: dueDay ? new Date(dueDay.getTime() + 86_399_000) : null,
        status: "active",
        createdAt: new Date(),
      })
      .returning({ id: evalPlans.id })
      .get();
    throw redirect(`/admin/${eventId}/evaluations/${created.id}`);
  }

  if (intent === "bulk-close") {
    const ids = form.getAll("ids").map(Number).filter(Number.isInteger);
    if (ids.length === 0) return { error: "Select at least one plan." };
    await db
      .update(evalPlans)
      .set({ status: "closed" })
      .where(and(eq(evalPlans.eventId, eventId), inArray(evalPlans.id, ids)));
    return { error: null, notice: `Closed ${ids.length} ${ids.length === 1 ? "plan" : "plans"}.` };
  }

  return { error: null };
}

export default function Evaluations({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, plans, total } = loaderData;
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <PageHeader title="Evaluations" description="Evaluation plans, evaluator pools, assignments, and scores." />

      {actionData?.error ? (
        <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {actionData.error}
        </div>
      ) : null}
      {actionData && "notice" in actionData && actionData.notice ? (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{actionData.notice}</div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Form method="get" className="flex flex-1 flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={searchParams.get("q") ?? ""}
              placeholder="Search plans"
              aria-label="Search plans"
              className={`${inputSized} w-56 flex-none`}
            />
            <select name="status" defaultValue={searchParams.get("status") ?? ""} aria-label="Filter by status" className={`${selectSized} w-36 flex-none`}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
              <option value="draft">Draft</option>
            </select>
            <button type="submit" className={buttonSecondary}>
              Filter
            </button>
          </Form>
          <a href={`/admin/${params.eventId}/evaluations/export.csv?${searchParams.toString()}`} className={buttonSecondary}>
            Export CSV
          </a>
        </div>

        {plans.length === 0 ? (
          <EmptyState message={total === 0 ? "No evaluation plans yet. Create the first round below." : "No plans match this filter."} />
        ) : (
          <Form method="post">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="w-8 px-3 py-2">
                      <span className="sr-only">Select</span>
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">Plan</th>
                    <th scope="col" className="px-3 py-2 font-medium">Round</th>
                    <th scope="col" className="px-3 py-2 font-medium">Scorecard</th>
                    <th scope="col" className="px-3 py-2 font-medium">Settings</th>
                    <th scope="col" className="px-3 py-2 font-medium">Due</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Reviewers</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Progress</th>
                    <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-3">
                        <input
                          type="checkbox"
                          name="ids"
                          value={plan.id}
                          checked={selected.has(plan.id)}
                          onChange={() => toggle(plan.id)}
                          aria-label={`Select ${plan.name}`}
                          className="accent-accent"
                        />
                      </td>
                      <td className="h-10 px-3">
                        <Link to={`/admin/${params.eventId}/evaluations/${plan.id}`} className="font-medium text-slate-900 hover:text-accent">
                          {plan.name}
                        </Link>
                      </td>
                      <td className="px-3 tabular-nums text-slate-900">{plan.round}</td>
                      <td className="px-3 text-slate-500">{plan.scaleType === "rubric" ? "Weighted rubric" : "5-star rating"}</td>
                      <td className="px-3">
                        <span className="flex flex-wrap gap-1">
                          {plan.blind ? <Badge>Blind</Badge> : null}
                          {plan.anonymized ? <Badge>Anonymized</Badge> : null}
                        </span>
                      </td>
                      <td className="px-3 text-slate-500">{plan.dueAt ? formatDate(plan.dueAt, event.timezone) : ""}</td>
                      <td className="px-3 text-right tabular-nums text-slate-900">{plan.reviewerCount}</td>
                      <td className="px-3 text-right tabular-nums text-slate-900">
                        {plan.doneCount}/{plan.assignmentCount}
                      </td>
                      <td className="px-3">
                        <Badge>{plan.status === "active" ? "Active" : plan.status === "closed" ? "Closed" : "Draft"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected.size > 0 ? (
              <div className="flex items-center gap-3 border-t border-slate-200 px-3 py-2.5">
                <p className="text-[13px] text-slate-500">{selected.size} selected</p>
                <button
                  type="submit"
                  name="intent"
                  value="bulk-close"
                  className={buttonSecondary}
                  onClick={(e) => {
                    if (!confirm(`Close ${selected.size} ${selected.size === 1 ? "plan" : "plans"}? Evaluators keep their recorded scores.`)) {
                      e.preventDefault();
                    }
                  }}
                >
                  Close selected
                </button>
              </div>
            ) : null}
          </Form>
        )}
      </Card>

      <Card className="mt-4 max-w-[720px] p-4">
        <h2 className="text-sm font-semibold text-slate-900">New evaluation plan</h2>
        <Form method="post" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Name" name="name" required>
              <input id="name" name="name" placeholder="Initial Review" className={inputClass} required />
            </Field>
            <Field label="Round" name="round">
              <input id="round" name="round" type="number" min={1} defaultValue={1} className={inputClass} />
            </Field>
            <Field label="Scorecard" name="scaleType">
              <select id="scaleType" name="scaleType" className={selectClass}>
                <option value="stars5">5-star rating plus comment</option>
                <option value="rubric">Weighted rubric criteria</option>
              </select>
            </Field>
            <Field label="Max evaluations per submission" name="maxEvals" help="Empty means no cap.">
              <input id="maxEvals" name="maxEvals" type="number" min={1} className={inputClass} />
            </Field>
            <Field label="Due date" name="dueAt">
              <input id="dueAt" name="dueAt" type="date" className={inputClass} />
            </Field>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input type="checkbox" name="blind" defaultChecked className="accent-accent" />
              Blind: evaluators never see each other's scores
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input type="checkbox" name="anonymized" className="accent-accent" />
              Anonymized: hide speaker identities from evaluators
            </label>
          </div>
          <button type="submit" name="intent" value="create" className={buttonPrimary}>
            Create plan
          </button>
        </Form>
      </Card>
    </>
  );
}
