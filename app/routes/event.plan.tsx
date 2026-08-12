// One evaluation plan: settings, the scorecard, the reviewer pool for this round,
// the assignment matrix (with auto-distribute, per-round score threshold, and track
// filter), and per-reviewer progress with reminders.

import { Form, Link } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/event.plan";
import { appBaseUrl, bindings, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { getCriteria, sessionScoreMap } from "../lib/evals.server";
import { createAccount, generateTempPassword } from "../lib/users.server";
import { sendEmail } from "../lib/email";
import { formatDate, formatScore, fromDateInputValue, toDateInputValue } from "../lib/format";
import {
  evalAssignments,
  evalCriteria,
  evalPlanReviewers,
  evalPlans,
  events,
  sessions,
  statuses,
  tracks,
  users,
} from "../../database/schema";
import {
  Badge,
  Breadcrumbs,
  Card,
  Field,
  PageHeader,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  inputSized,
  selectClass,
  selectSized,
  textareaClass,
} from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.plan ? `${loaderData.plan.name} | Evaluations` : "Evaluation plan" }];
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
    .select()
    .from(evalPlans)
    .where(and(eq(evalPlans.id, planId), eq(evalPlans.eventId, eventId)))
    .get();
  if (!plan) throw new Response("Plan not found", { status: 404 });

  const criteria = await getCriteria(planId);

  const pool = await db
    .select({ userId: evalPlanReviewers.userId, name: users.name, email: users.email })
    .from(evalPlanReviewers)
    .innerJoin(users, eq(evalPlanReviewers.userId, users.id))
    .where(eq(evalPlanReviewers.planId, planId))
    .orderBy(asc(users.name))
    .all();

  const evaluatorUsers = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.role, "evaluator"))
    .orderBy(asc(users.name))
    .all();
  const poolIds = new Set(pool.map((p) => p.userId));
  const available = evaluatorUsers.filter((u) => !poolIds.has(u.id));

  const assignments = await db
    .select({
      id: evalAssignments.id,
      evaluatorUserId: evalAssignments.evaluatorUserId,
      sessionId: evalAssignments.sessionId,
      status: evalAssignments.status,
    })
    .from(evalAssignments)
    .where(eq(evalAssignments.planId, planId))
    .all();

  // Assignable submissions: non-draft abstracts for this event.
  const submissionRows = await db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      trackId: sessions.trackId,
      statusLabel: statuses.label,
    })
    .from(sessions)
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(and(eq(sessions.eventId, eventId), eq(sessions.isDraft, false), eq(sessions.isAbstract, true)))
    .orderBy(asc(sessions.id))
    .all();

  const scores = await sessionScoreMap(submissionRows.map((s) => s.id));

  const url = new URL(request.url);
  const minScoreRaw = url.searchParams.get("minScore") ?? "";
  const minScore = minScoreRaw.trim() === "" ? null : Number(minScoreRaw);
  const trackFilter = Number(url.searchParams.get("trackFilter") ?? 0) || null;

  const eligible = submissionRows
    .map((row) => ({ ...row, scoreAvg: scores.get(row.id)?.avg ?? null }))
    .filter((row) => {
      if (minScore != null && !Number.isNaN(minScore) && (row.scoreAvg ?? -1) < minScore) return false;
      if (trackFilter && row.trackId !== trackFilter) return false;
      return true;
    });

  const trackRows = await db
    .select({ id: tracks.id, name: tracks.name })
    .from(tracks)
    .where(eq(tracks.eventId, eventId))
    .orderBy(asc(tracks.sort))
    .all();

  const progress = pool.map((member) => {
    const mine = assignments.filter((a) => a.evaluatorUserId === member.userId);
    return {
      ...member,
      assigned: mine.length,
      done: mine.filter((a) => a.status === "done").length,
    };
  });

  return {
    event,
    plan,
    criteria,
    pool,
    available,
    assignments,
    eligible,
    totalSubmissions: submissionRows.length,
    tracks: trackRows,
    progress,
    filters: { minScore: minScoreRaw, trackFilter },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const planId = Number(params.planId);
  const db = getDb();

  const plan = await db
    .select()
    .from(evalPlans)
    .where(and(eq(evalPlans.id, planId), eq(evalPlans.eventId, eventId)))
    .get();
  if (!plan) throw new Response("Plan not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const now = new Date();

  if (intent === "settings") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { error: "Enter a plan name." };
    const dueDay = fromDateInputValue(form.get("dueAt"));
    const maxEvalsRaw = String(form.get("maxEvals") ?? "").trim();
    const statusRaw = String(form.get("status") ?? "active");
    await db
      .update(evalPlans)
      .set({
        name,
        round: Math.max(1, Number(form.get("round") ?? plan.round) || plan.round),
        scaleType: String(form.get("scaleType") ?? plan.scaleType) === "rubric" ? "rubric" : "stars5",
        blind: form.get("blind") === "on",
        anonymized: form.get("anonymized") === "on",
        maxEvalsPerSubmission: maxEvalsRaw ? Math.max(1, Number(maxEvalsRaw) || 1) : null,
        dueAt: dueDay ? new Date(dueDay.getTime() + 86_399_000) : null,
        status: statusRaw === "closed" ? "closed" : statusRaw === "draft" ? "draft" : "active",
      })
      .where(eq(evalPlans.id, planId));
    return { error: null, notice: "Plan settings saved." };
  }

  if (intent === "add-criterion" || intent === "update-criterion") {
    const label = String(form.get("label") ?? "").trim();
    if (!label) return { error: "Enter a criterion label." };
    const kindRaw = String(form.get("kind") ?? "numeric");
    const kind = kindRaw === "select" ? "select" : kindRaw === "text" ? "text" : "numeric";
    const weight = Math.max(1, Number(form.get("weight") ?? 1) || 1);
    const options = String(form.get("options") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (intent === "add-criterion") {
      const existing = await db.select({ sort: evalCriteria.sort }).from(evalCriteria).where(eq(evalCriteria.planId, planId)).all();
      await db.insert(evalCriteria).values({
        planId,
        label,
        kind,
        optionsJson: JSON.stringify(options),
        weight,
        sort: existing.reduce((max, c) => Math.max(max, c.sort), -1) + 1,
      });
      return { error: null, notice: `Criterion "${label}" added.` };
    }

    const id = Number(form.get("id") ?? 0);
    await db
      .update(evalCriteria)
      .set({ label, kind, optionsJson: JSON.stringify(options), weight })
      .where(and(eq(evalCriteria.id, id), eq(evalCriteria.planId, planId)));
    return { error: null, notice: `Criterion "${label}" saved.` };
  }

  if (intent === "delete-criterion") {
    const id = Number(form.get("id") ?? 0);
    await db.delete(evalCriteria).where(and(eq(evalCriteria.id, id), eq(evalCriteria.planId, planId)));
    return { error: null, notice: "Criterion deleted." };
  }

  if (intent === "move-criterion") {
    const id = Number(form.get("id") ?? 0);
    const direction = String(form.get("direction") ?? "up") === "down" ? 1 : -1;
    const list = await db
      .select({ id: evalCriteria.id, sort: evalCriteria.sort })
      .from(evalCriteria)
      .where(eq(evalCriteria.planId, planId))
      .orderBy(asc(evalCriteria.sort), asc(evalCriteria.id))
      .all();
    const index = list.findIndex((row) => row.id === id);
    const swapWith = index + direction;
    if (index === -1 || swapWith < 0 || swapWith >= list.length) return { error: null };
    const reordered = [...list];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(swapWith, 0, moved);
    for (const [position, row] of reordered.entries()) {
      await db.update(evalCriteria).set({ sort: position }).where(eq(evalCriteria.id, row.id));
    }
    return { error: null };
  }

  if (intent === "pool-add") {
    const userId = Number(form.get("userId") ?? 0);
    const user = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId)).get();
    if (!user) return { error: "Choose an evaluator to add." };
    await db.insert(evalPlanReviewers).values({ planId, userId, createdAt: now }).onConflictDoNothing();
    return { error: null, notice: `${user.name} added to this round's pool.` };
  }

  if (intent === "pool-remove") {
    const userId = Number(form.get("userId") ?? 0);
    await db.delete(evalPlanReviewers).where(and(eq(evalPlanReviewers.planId, planId), eq(evalPlanReviewers.userId, userId)));
    // Their unfinished assignments go too; completed reviews stay on record.
    await db
      .delete(evalAssignments)
      .where(
        and(eq(evalAssignments.planId, planId), eq(evalAssignments.evaluatorUserId, userId), eq(evalAssignments.status, "pending"))
      );
    return { error: null, notice: "Removed from the pool. Completed reviews were kept." };
  }

  if (intent === "invite") {
    const name = String(form.get("inviteName") ?? "").trim();
    const email = String(form.get("inviteEmail") ?? "").trim().toLowerCase();
    const passwordRaw = String(form.get("invitePassword") ?? "");
    if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { error: "Enter the evaluator's name and a valid email." };
    }

    const existing = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email)).get();
    if (existing) {
      if (existing.role !== "evaluator" && existing.role !== "admin" && existing.role !== "organizer") {
        return { error: "That email belongs to a speaker account. Ask them to use a different email for reviewing." };
      }
      await db.insert(evalPlanReviewers).values({ planId, userId: existing.id, createdAt: now }).onConflictDoNothing();
      return { error: null, notice: `${name} already has an account. Added to this round's pool.` };
    }

    const password = passwordRaw || generateTempPassword();
    const result = await createAccount({ name, email, password, role: "evaluator" });
    if ("error" in result) return { error: result.error };
    await db.insert(evalPlanReviewers).values({ planId, userId: result.userId, createdAt: now });

    const event = await db.select({ name: events.name }).from(events).where(eq(events.id, eventId)).get();
    await sendEmail(bindings, {
      eventId,
      templateKey: "reviewer_invite",
      toEmail: email,
      toName: name,
      subject: `You are invited to review for ${event?.name ?? "our event"}`,
      bodyHtml: `<p>Hi ${name},</p><p>You have been added as an evaluator for ${event?.name ?? "our event"}. Sign in at ${appBaseUrl()}/login to start reviewing.</p>`,
    });

    return {
      error: null,
      notice: passwordRaw
        ? `Account created for ${name} with the password you set. They sign in at /login.`
        : `Account created for ${name}. Temporary password: ${password} (shown once, copy it now). They sign in at /login.`,
    };
  }

  if (intent === "auto-distribute") {
    const per = Math.max(1, Number(form.get("per") ?? plan.maxEvalsPerSubmission ?? 1) || 1);
    const minScoreRaw = String(form.get("minScore") ?? "").trim();
    const minScore = minScoreRaw === "" ? null : Number(minScoreRaw);
    const trackFilter = Number(form.get("trackFilter") ?? 0) || null;

    const pool = await db
      .select({ userId: evalPlanReviewers.userId })
      .from(evalPlanReviewers)
      .where(eq(evalPlanReviewers.planId, planId))
      .all();
    if (pool.length === 0) return { error: "Add evaluators to the pool first." };

    const submissionRows = await db
      .select({ id: sessions.id, trackId: sessions.trackId })
      .from(sessions)
      .where(and(eq(sessions.eventId, eventId), eq(sessions.isDraft, false), eq(sessions.isAbstract, true)))
      .all();
    const scores = await sessionScoreMap(submissionRows.map((s) => s.id));
    const targets = submissionRows.filter((row) => {
      if (minScore != null && !Number.isNaN(minScore) && (scores.get(row.id)?.avg ?? -1) < minScore) return false;
      if (trackFilter && row.trackId !== trackFilter) return false;
      return true;
    });

    const existing = await db
      .select({ evaluatorUserId: evalAssignments.evaluatorUserId, sessionId: evalAssignments.sessionId })
      .from(evalAssignments)
      .where(eq(evalAssignments.planId, planId))
      .all();
    const load = new Map<number, number>(pool.map((p) => [p.userId, 0]));
    for (const a of existing) load.set(a.evaluatorUserId, (load.get(a.evaluatorUserId) ?? 0) + 1);

    const cap = plan.maxEvalsPerSubmission;
    let created = 0;
    for (const target of targets) {
      const have = existing.filter((a) => a.sessionId === target.id);
      const wanted = Math.min(per, cap ?? per);
      let need = wanted - have.length;
      if (need <= 0) continue;

      const candidates = pool
        .map((p) => p.userId)
        .filter((userId) => !have.some((a) => a.evaluatorUserId === userId))
        .sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0));

      for (const userId of candidates) {
        if (need <= 0) break;
        await db.insert(evalAssignments).values({ planId, evaluatorUserId: userId, sessionId: target.id, status: "pending", createdAt: now });
        existing.push({ evaluatorUserId: userId, sessionId: target.id });
        load.set(userId, (load.get(userId) ?? 0) + 1);
        created += 1;
        need -= 1;
      }
    }
    return { error: null, notice: `Auto-distributed ${created} ${created === 1 ? "assignment" : "assignments"} across ${pool.length} evaluators.` };
  }

  if (intent === "save-matrix") {
    const gridSessions = String(form.get("gridSessions") ?? "")
      .split(",")
      .map(Number)
      .filter(Number.isInteger);
    const pool = await db
      .select({ userId: evalPlanReviewers.userId })
      .from(evalPlanReviewers)
      .where(eq(evalPlanReviewers.planId, planId))
      .all();
    const existing = await db
      .select({ id: evalAssignments.id, evaluatorUserId: evalAssignments.evaluatorUserId, sessionId: evalAssignments.sessionId, status: evalAssignments.status })
      .from(evalAssignments)
      .where(eq(evalAssignments.planId, planId))
      .all();

    let added = 0;
    let removed = 0;
    for (const sessionId of gridSessions) {
      for (const member of pool) {
        const checked = form.get(`cell-${sessionId}-${member.userId}`) === "on";
        const current = existing.find((a) => a.sessionId === sessionId && a.evaluatorUserId === member.userId);
        if (checked && !current) {
          await db.insert(evalAssignments).values({ planId, evaluatorUserId: member.userId, sessionId, status: "pending", createdAt: now });
          added += 1;
        } else if (!checked && current && current.status === "pending") {
          await db.delete(evalAssignments).where(eq(evalAssignments.id, current.id));
          removed += 1;
        }
      }
    }
    return { error: null, notice: `Assignments saved: ${added} added, ${removed} removed.` };
  }

  if (intent === "remind") {
    const userId = Number(form.get("userId") ?? 0);
    const user = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).get();
    if (!user) return { error: "Unknown evaluator." };
    const pending = await db
      .select({ id: evalAssignments.id })
      .from(evalAssignments)
      .where(and(eq(evalAssignments.planId, planId), eq(evalAssignments.evaluatorUserId, userId), eq(evalAssignments.status, "pending")))
      .all();
    const event = await db.select({ name: events.name }).from(events).where(eq(events.id, eventId)).get();

    await sendEmail(bindings, {
      eventId,
      templateKey: "reviewer_reminder",
      toEmail: user.email,
      toName: user.name,
      subject: `Reminder: ${pending.length} ${pending.length === 1 ? "review" : "reviews"} waiting in ${plan.name}`,
      bodyHtml: `<p>Hi ${user.name},</p><p>You have ${pending.length} outstanding ${pending.length === 1 ? "review" : "reviews"} for ${event?.name ?? "our event"} (${plan.name}). Review at ${appBaseUrl()}/review.</p>`,
    });
    return { error: null, notice: `Reminder sent to ${user.name} (${pending.length} outstanding).` };
  }

  return { error: null };
}

export default function PlanDetail({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, plan, criteria, pool, available, assignments, eligible, totalSubmissions, tracks: trackRows, progress, filters } =
    loaderData;

  const assignmentFor = (sessionId: number, userId: number) =>
    assignments.find((a) => a.sessionId === sessionId && a.evaluatorUserId === userId);

  return (
    <>
      <Breadcrumbs items={[{ to: `/admin/${params.eventId}/evaluations`, label: "Evaluations" }, { label: plan.name }]} />

      <PageHeader
        title={plan.name}
        description={`Round ${plan.round}, ${plan.scaleType === "rubric" ? "weighted rubric" : "5-star rating"}${plan.dueAt ? `, due ${formatDate(plan.dueAt, event.timezone)}` : ""}`}
        actions={
          <Link to={`/admin/${params.eventId}/evaluations/${plan.id}/results`} className={buttonPrimary}>
            View results
          </Link>
        }
      />

      {actionData?.error ? (
        <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {actionData.error}
        </div>
      ) : null}
      {actionData && "notice" in actionData && actionData.notice ? (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{actionData.notice}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Settings</h2>
          <Form method="post" className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
              <Field label="Name" name="name" required>
                <input id="name" name="name" defaultValue={plan.name} className={inputClass} required />
              </Field>
              <Field label="Round" name="round">
                <input id="round" name="round" type="number" min={1} defaultValue={plan.round} className={inputClass} />
              </Field>
              <Field label="Scorecard" name="scaleType">
                <select id="scaleType" name="scaleType" defaultValue={plan.scaleType} className={selectClass}>
                  <option value="stars5">5-star rating plus comment</option>
                  <option value="rubric">Weighted rubric criteria</option>
                </select>
              </Field>
              <Field label="Max evaluations per submission" name="maxEvals" help="Empty means no cap.">
                <input id="maxEvals" name="maxEvals" type="number" min={1} defaultValue={plan.maxEvalsPerSubmission ?? ""} className={inputClass} />
              </Field>
              <Field label="Due date" name="dueAt">
                <input id="dueAt" name="dueAt" type="date" defaultValue={toDateInputValue(plan.dueAt)} className={inputClass} />
              </Field>
              <Field label="Status" name="status">
                <select id="status" name="status" defaultValue={plan.status} className={selectClass}>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                  <option value="draft">Draft</option>
                </select>
              </Field>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-900">
                <input type="checkbox" name="blind" defaultChecked={plan.blind} className="accent-accent" />
                Blind: evaluators never see each other's scores
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-900">
                <input type="checkbox" name="anonymized" defaultChecked={plan.anonymized} className="accent-accent" />
                Anonymized: hide speaker identities from evaluators
              </label>
            </div>
            <button type="submit" name="intent" value="settings" className={buttonSecondary}>
              Save settings
            </button>
          </Form>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Scorecard</h2>
          {plan.scaleType === "stars5" ? (
            <p className="mt-2 text-sm text-slate-500">
              Evaluators give a single 1 to 5 rating plus a comment. Switch the scorecard to "Weighted rubric criteria" in Settings to
              score multiple criteria.
            </p>
          ) : (
            <>
              {criteria.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No criteria yet. Evaluators cannot score until you add at least one.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {criteria.map((criterion, index) => (
                    <li key={criterion.id} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900">{criterion.label}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500">
                            <Badge>
                              {criterion.kind === "numeric" ? "1 to 5 rating" : criterion.kind === "select" ? "Dropdown" : "Free text"}
                            </Badge>
                            {criterion.kind === "numeric" ? <span>Weight {criterion.weight}</span> : null}
                            {criterion.kind === "select" && criterion.options.length > 0 ? <span>{criterion.options.join(" / ")}</span> : null}
                          </p>
                        </div>
                        <Form method="post">
                          <input type="hidden" name="id" value={criterion.id} />
                          <input type="hidden" name="direction" value="up" />
                          <button type="submit" name="intent" value="move-criterion" className={buttonGhost} disabled={index === 0} aria-label={`Move ${criterion.label} up`}>
                            Up
                          </button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="id" value={criterion.id} />
                          <input type="hidden" name="direction" value="down" />
                          <button
                            type="submit"
                            name="intent"
                            value="move-criterion"
                            className={buttonGhost}
                            disabled={index === criteria.length - 1}
                            aria-label={`Move ${criterion.label} down`}
                          >
                            Down
                          </button>
                        </Form>
                        <Form method="post" onSubmit={(e) => !confirm(`Delete the criterion "${criterion.label}"?`) && e.preventDefault()}>
                          <input type="hidden" name="id" value={criterion.id} />
                          <button type="submit" name="intent" value="delete-criterion" className={buttonGhost} aria-label={`Delete ${criterion.label}`}>
                            Delete
                          </button>
                        </Form>
                      </div>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[13px] font-medium text-accent">Edit criterion</summary>
                        <Form method="post" className="mt-3 space-y-3 border-l-2 border-slate-100 pl-4">
                          <input type="hidden" name="id" value={criterion.id} />
                          <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
                            <input name="label" defaultValue={criterion.label} aria-label="Criterion label" className={inputClass} required />
                            <select name="kind" defaultValue={criterion.kind} aria-label="Criterion type" className={selectClass}>
                              <option value="numeric">1 to 5 rating</option>
                              <option value="select">Dropdown</option>
                              <option value="text">Free text</option>
                            </select>
                            <input
                              name="weight"
                              type="number"
                              min={1}
                              defaultValue={criterion.weight}
                              aria-label="Weight"
                              placeholder="Weight"
                              className={inputClass}
                            />
                          </div>
                          <textarea
                            name="options"
                            rows={2}
                            defaultValue={criterion.options.join("\n")}
                            aria-label="Dropdown options"
                            placeholder="Dropdown options, one per line"
                            className={textareaClass}
                          />
                          <button type="submit" name="intent" value="update-criterion" className={buttonSecondary}>
                            Save criterion
                          </button>
                        </Form>
                      </details>
                    </li>
                  ))}
                </ul>
              )}

              <Form method="post" className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
                  <input name="label" placeholder="Criterion, e.g. Originality" aria-label="New criterion label" className={inputClass} required />
                  <select name="kind" aria-label="New criterion type" className={selectClass}>
                    <option value="numeric">1 to 5 rating</option>
                    <option value="select">Dropdown</option>
                    <option value="text">Free text</option>
                  </select>
                  <input name="weight" type="number" min={1} defaultValue={1} aria-label="New criterion weight" placeholder="Weight" className={inputClass} />
                </div>
                <textarea
                  name="options"
                  rows={2}
                  aria-label="New criterion dropdown options"
                  placeholder="Dropdown options, one per line (for the Dropdown type)"
                  className={textareaClass}
                />
                <button type="submit" name="intent" value="add-criterion" className={buttonSecondary}>
                  Add criterion
                </button>
              </Form>
            </>
          )}
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold text-slate-900">Reviewer pool for this round</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Pool membership is per round: an evaluator in round {plan.round} is not automatically in other rounds.
        </p>

        {pool.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No evaluators in this round's pool yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {progress.map((member) => (
              <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{member.name}</p>
                  <p className="text-[13px] text-slate-500">{member.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-[13px] tabular-nums text-slate-500">
                    {member.done} of {member.assigned} done
                  </p>
                  <Form method="post">
                    <input type="hidden" name="userId" value={member.userId} />
                    <button type="submit" name="intent" value="remind" className={buttonSecondary} disabled={member.done >= member.assigned}>
                      Send reminder
                    </button>
                  </Form>
                  <Form method="post" onSubmit={(e) => !confirm(`Remove ${member.name} from this round? Pending assignments are removed, completed reviews stay.`) && e.preventDefault()}>
                    <input type="hidden" name="userId" value={member.userId} />
                    <button type="submit" name="intent" value="pool-remove" className={buttonGhost}>
                      Remove
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 grid gap-4 border-t border-slate-200 pt-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Form method="post" className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1.5">
              <label htmlFor="pool-user" className="block text-sm font-medium text-slate-900">
                Add an existing evaluator
              </label>
              <select id="pool-user" name="userId" className={selectClass}>
                {available.length === 0 ? <option value="">No unassigned evaluator accounts</option> : null}
                {available.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" name="intent" value="pool-add" className={buttonSecondary} disabled={available.length === 0}>
              Add to pool
            </button>
          </Form>

          <Form method="post" className="space-y-2">
            <p className="text-sm font-medium text-slate-900">Invite a new evaluator by email</p>
            <div className="grid gap-2 sm:grid-cols-2 [&>*]:min-w-0">
              <input name="inviteName" placeholder="Name" aria-label="Evaluator name" className={inputClass} />
              <input name="inviteEmail" type="email" placeholder="Email" aria-label="Evaluator email" className={inputClass} />
            </div>
            <input
              name="invitePassword"
              placeholder="Password (optional; a temporary one is generated if empty)"
              aria-label="Evaluator password"
              className={inputClass}
            />
            <button type="submit" name="intent" value="invite" className={buttonSecondary}>
              Create account and add to pool
            </button>
          </Form>
        </div>
      </Card>

      <Card className="mt-4">
        <div className="border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-900">Assignments</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {eligible.length} of {totalSubmissions} submissions shown. Tick a cell to assign, untick to unassign (completed reviews stay).
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 px-4 py-3">
          <Form method="get" className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <label htmlFor="minScore" className="block text-[13px] font-medium text-slate-900">
                Min average score
              </label>
              <input
                id="minScore"
                name="minScore"
                type="number"
                step="0.1"
                min={0}
                max={5}
                defaultValue={filters.minScore}
                placeholder={plan.round > 1 ? "e.g. 3.5" : "Any"}
                className={`${inputSized} w-32`}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="trackFilter" className="block text-[13px] font-medium text-slate-900">
                Track
              </label>
              <select id="trackFilter" name="trackFilter" defaultValue={filters.trackFilter ?? ""} className={`${selectSized} w-44`}>
                <option value="">All tracks</option>
                {trackRows.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={buttonSecondary}>
              Filter
            </button>
          </Form>

          <Form method="post" className="ml-auto flex flex-wrap items-end gap-2">
            <input type="hidden" name="minScore" value={filters.minScore} />
            <input type="hidden" name="trackFilter" value={filters.trackFilter ?? ""} />
            <div className="space-y-1.5">
              <label htmlFor="per" className="block text-[13px] font-medium text-slate-900">
                Evaluations per submission
              </label>
              <input id="per" name="per" type="number" min={1} defaultValue={plan.maxEvalsPerSubmission ?? 1} className={`${inputSized} w-28`} />
            </div>
            <button type="submit" name="intent" value="auto-distribute" className={buttonPrimary}>
              Auto-distribute
            </button>
          </Form>
        </div>

        {pool.length === 0 || eligible.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">
            {pool.length === 0 ? "Add evaluators to the pool to start assigning." : "No submissions match this filter."}
          </p>
        ) : (
          <Form method="post">
            <input type="hidden" name="gridSessions" value={eligible.map((s) => s.id).join(",")} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="px-4 py-2 font-medium">Submission</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Score</th>
                    {pool.map((member) => (
                      <th scope="col" key={member.userId} className="px-3 py-2 text-center font-medium">
                        {member.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {eligible.map((submission) => (
                    <tr key={submission.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="h-10 max-w-[360px] px-4">
                        <span className="block truncate font-medium text-slate-900">{submission.title}</span>
                        <span className="text-xs text-slate-500">
                          {submission.friendlyId}
                          {submission.statusLabel ? `, ${submission.statusLabel}` : ""}
                        </span>
                      </td>
                      <td className="px-3 text-right tabular-nums text-slate-900">
                        {submission.scoreAvg != null ? formatScore(submission.scoreAvg) : ""}
                      </td>
                      {pool.map((member) => {
                        const assignment = assignmentFor(submission.id, member.userId);
                        const isDone = assignment?.status === "done";
                        return (
                          <td key={member.userId} className="px-3 text-center">
                            {isDone ? (
                              <span title="Review completed" className="text-[13px] font-medium text-accent">
                                Done
                              </span>
                            ) : (
                              <input
                                type="checkbox"
                                name={`cell-${submission.id}-${member.userId}`}
                                defaultChecked={Boolean(assignment)}
                                aria-label={`Assign ${submission.title} to ${member.name}`}
                                className="accent-accent"
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-200 px-4 py-2.5">
              <button type="submit" name="intent" value="save-matrix" className={buttonSecondary}>
                Save assignments
              </button>
            </div>
          </Form>
        )}
      </Card>
    </>
  );
}
