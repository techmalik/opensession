// Scoring one assigned submission. Scoped hard to the signed-in evaluator: an
// assignment id that is not theirs is a 404, so URL guessing reveals nothing.
// Anonymized plans strip speaker identity; other evaluators' scores are never
// fetched here, blind or not.

import { Form, Link, redirect, useNavigation } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/review.assignment";
import { getDb } from "../lib/db.server";
import { requireUser } from "../lib/session.server";
import { getFields, withColumnFallbacks, type FieldDef } from "../lib/cfp.server";
import { getCriteria } from "../lib/evals.server";
import { formatDate } from "../lib/format";
import { ROLE_LABEL } from "../lib/labels";
import {
  contacts,
  evalAssignments,
  evalPlans,
  evalScores,
  events,
  formats,
  levels,
  sessionParticipants,
  sessions,
  tracks,
} from "../../database/schema";
import { AppBar, Card, ErrorSummary, buttonPrimary, selectClass, textareaClass } from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `Review: ${loaderData.submission.title}` : "Review" }];
}

function parseAnswers(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function loadAssignment(assignmentId: number, userId: number) {
  const db = getDb();
  const assignment = await db
    .select()
    .from(evalAssignments)
    .where(and(eq(evalAssignments.id, assignmentId), eq(evalAssignments.evaluatorUserId, userId)))
    .get();
  if (!assignment) throw new Response("Not found", { status: 404 });

  const plan = await db.select().from(evalPlans).where(eq(evalPlans.id, assignment.planId)).get();
  const session = await db.select().from(sessions).where(eq(sessions.id, assignment.sessionId)).get();
  if (!plan || !session || session.isDraft) throw new Response("Not found", { status: 404 });

  return { assignment, plan, session };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const assignmentId = Number(params.assignmentId);
  if (!Number.isInteger(assignmentId)) throw new Response("Not found", { status: 404 });

  const { assignment, plan, session } = await loadAssignment(assignmentId, user.id);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, plan.eventId))
    .get();
  if (!event) throw new Response("Not found", { status: 404 });

  const fields: FieldDef[] = session.formId ? await getFields(session.formId, event.id) : [];
  const trackRow = session.trackId ? await db.select({ name: tracks.name }).from(tracks).where(eq(tracks.id, session.trackId)).get() : null;
  const formatRow = session.formatId
    ? await db.select({ name: formats.name }).from(formats).where(eq(formats.id, session.formatId)).get()
    : null;
  const levelRow = session.levelId ? await db.select({ name: levels.name }).from(levels).where(eq(levels.id, session.levelId)).get() : null;
  const answers = withColumnFallbacks(parseAnswers(session.answersJson), session, {
    track: trackRow?.name,
    format: formatRow?.name,
    level: levelRow?.name,
  });
  const criteria = await getCriteria(plan.id);

  // Anonymized rounds hide who is speaking. Session content only.
  const participants = plan.anonymized
    ? []
    : await db
        .select({
          id: sessionParticipants.id,
          role: sessionParticipants.role,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          company: contacts.company,
          bio: contacts.bio,
        })
        .from(sessionParticipants)
        .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
        .where(eq(sessionParticipants.sessionId, session.id))
        .orderBy(asc(sessionParticipants.sort), asc(sessionParticipants.id))
        .all();

  const myScores = await db.select().from(evalScores).where(eq(evalScores.assignmentId, assignment.id)).all();

  const overall = myScores.find((s) => s.criterionId === null);

  // Next unscored item in the same plan drives the after-submit flow.
  const url = new URL(request.url);

  return {
    user,
    event,
    plan: {
      id: plan.id,
      name: plan.name,
      round: plan.round,
      anonymized: plan.anonymized,
      scaleType: plan.scaleType,
      status: plan.status,
      dueAt: plan.dueAt,
    },
    assignment: { id: assignment.id, status: assignment.status },
    submission: {
      id: session.id,
      friendlyId: session.friendlyId,
      title: session.title,
    },
    fields,
    answers,
    participants: participants.map((p) => ({
      id: p.id,
      role: p.role,
      name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
      company: p.company,
      bio: p.bio,
    })),
    criteria,
    existing: {
      rating: overall && overall.score > 0 ? overall.score : null,
      comment: overall?.comment ?? myScores.find((s) => s.comment)?.comment ?? "",
      byCriterion: Object.fromEntries(
        myScores.filter((s) => s.criterionId !== null).map((s) => [s.criterionId as number, { score: s.score, valueText: s.valueText }])
      ) as Record<number, { score: number; valueText: string | null }>,
    },
    saved: url.searchParams.get("saved") === "1",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const assignmentId = Number(params.assignmentId);
  const { assignment, plan } = await loadAssignment(assignmentId, user.id);
  if (plan.status === "closed") return { errors: { form: "This review round is closed. Scores can no longer be changed." } };

  const db = getDb();
  const form = await request.formData();
  const comment = String(form.get("comment") ?? "").trim();
  const now = new Date();

  const criteria = await getCriteria(plan.id);
  const errors: Record<string, string> = {};
  const rows: (typeof evalScores.$inferInsert)[] = [];

  if (plan.scaleType === "stars5" || criteria.length === 0) {
    const rating = Number(form.get("rating") ?? 0);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      errors.rating = "Choose a rating from 1 to 5.";
    } else {
      rows.push({ assignmentId: assignment.id, criterionId: null, score: rating, comment: comment || null, createdAt: now });
    }
  } else {
    for (const criterion of criteria) {
      const raw = String(form.get(`c-${criterion.id}`) ?? "").trim();
      if (criterion.kind === "numeric") {
        const score = Number(raw);
        if (!Number.isInteger(score) || score < 1 || score > 5) {
          errors[`c-${criterion.id}`] = `Rate ${criterion.label} from 1 to 5.`;
          continue;
        }
        rows.push({ assignmentId: assignment.id, criterionId: criterion.id, score, createdAt: now });
      } else if (criterion.kind === "select") {
        if (!raw) {
          errors[`c-${criterion.id}`] = `Choose ${criterion.label.toLowerCase()}.`;
          continue;
        }
        rows.push({ assignmentId: assignment.id, criterionId: criterion.id, score: 0, valueText: raw, createdAt: now });
      } else {
        rows.push({ assignmentId: assignment.id, criterionId: criterion.id, score: 0, valueText: raw || null, createdAt: now });
      }
    }
    // The overall comment rides on a criterion-null holder row (score 0 = no rating).
    rows.push({ assignmentId: assignment.id, criterionId: null, score: 0, comment: comment || null, createdAt: now });
  }

  if (Object.keys(errors).length > 0) return { errors };

  await db.delete(evalScores).where(eq(evalScores.assignmentId, assignment.id));
  for (const row of rows) await db.insert(evalScores).values(row);
  await db.update(evalAssignments).set({ status: "done" }).where(eq(evalAssignments.id, assignment.id));

  // Next-unscored flow: jump to the next pending item in the same plan.
  const next = await db
    .select({ id: evalAssignments.id })
    .from(evalAssignments)
    .innerJoin(sessions, eq(evalAssignments.sessionId, sessions.id))
    .where(
      and(
        eq(evalAssignments.planId, plan.id),
        eq(evalAssignments.evaluatorUserId, user.id),
        eq(evalAssignments.status, "pending"),
        eq(sessions.isDraft, false)
      )
    )
    .orderBy(asc(evalAssignments.id))
    .get();

  throw redirect(next ? `/review/${next.id}?saved=1` : "/review?saved=1");
}

export default function ReviewAssignment({ loaderData, actionData }: Route.ComponentProps) {
  const { user, event, plan, assignment, submission, fields, answers, participants, criteria, existing, saved } = loaderData;
  const errors = actionData?.errors ?? {};
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const sessionFields = fields.filter((f) => f.section === "session");
  const speakerFields = plan.anonymized ? [] : fields.filter((f) => f.section === "speaker");
  const visible = (list: FieldDef[]) =>
    list.filter((field) => !field.conditional || (answers[field.conditional.fieldKey] ?? "") === field.conditional.value);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="OpenSession Review" userName={user.name} homeTo="/review" />

      <main className="mx-auto w-full max-w-[1100px] px-6 py-8">
        <div className="mb-2 text-[13px]">
          <Link to="/review" className="text-slate-500 hover:text-slate-900">
            Your review queue
          </Link>
          <span className="mx-1 text-slate-400">/</span>
          <span className="text-slate-900">{submission.friendlyId}</span>
        </div>

        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{submission.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {event.name}: {plan.name}, round {plan.round}
          {plan.dueAt ? `, due ${formatDate(plan.dueAt, event.timezone)}` : ""}
          {plan.anonymized ? ". Speaker identities are hidden for this round." : ""}
        </p>

        {saved ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
            Review saved. This is your next assigned submission.
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-900">Submission</h2>
              <dl className="mt-3 space-y-3">
                {visible(sessionFields).map((field) => (
                  <div key={field.fieldKey}>
                    <dt className="text-[13px] font-medium text-slate-500">{field.label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">
                      {(answers[field.fieldKey] ?? "").trim() || <span className="text-slate-400">Not answered</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>

            {plan.anonymized ? (
              <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900">Speakers</h2>
                <p className="mt-2 text-sm text-slate-500">Hidden: this round is anonymized.</p>
              </Card>
            ) : (
              <Card className="p-4">
                <h2 className="text-sm font-semibold text-slate-900">Speakers</h2>
                <ul className="mt-2 space-y-3">
                  {participants.map((p) => (
                    <li key={p.id}>
                      <p className="text-sm font-medium text-slate-900">
                        {p.name} <span className="font-normal text-slate-500">({ROLE_LABEL[p.role] ?? p.role})</span>
                      </p>
                      {p.company ? <p className="text-[13px] text-slate-500">{p.company}</p> : null}
                      {p.bio ? <p className="mt-0.5 text-[13px] text-slate-500">{p.bio}</p> : null}
                    </li>
                  ))}
                </ul>
                {speakerFields.length > 0 ? (
                  <dl className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                    {visible(speakerFields).map((field) => (
                      <div key={field.fieldKey}>
                        <dt className="text-[13px] font-medium text-slate-500">{field.label}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">
                          {(answers[field.fieldKey] ?? "").trim() || <span className="text-slate-400">Not answered</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </Card>
            )}
          </div>

          <Card className="h-fit p-4">
            <h2 className="text-sm font-semibold text-slate-900">
              {assignment.status === "done" ? "Your review (editing)" : "Your review"}
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">Only organizers see your scores. Other evaluators never do.</p>

            <Form method="post" noValidate className="mt-4 space-y-4">
              <ErrorSummary errors={errors} />

              {plan.scaleType === "stars5" || criteria.length === 0 ? (
                <div className="space-y-1.5">
                  <span className="block text-sm font-medium text-slate-900">
                    Rating<span className="ml-0.5 text-slate-500">*</span>
                  </span>
                  <div className="flex gap-3">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <label key={value} className="flex flex-col items-center gap-1 text-sm text-slate-900">
                        <input
                          type="radio"
                          name="rating"
                          value={value}
                          defaultChecked={existing.rating === value}
                          className="accent-accent"
                        />
                        {value}
                      </label>
                    ))}
                  </div>
                  <p className="text-[13px] text-slate-500">1 = weak, 5 = outstanding.</p>
                  {errors.rating ? <p className="text-[13px] text-rose-600">{errors.rating}</p> : null}
                </div>
              ) : (
                criteria.map((criterion) => (
                  <div key={criterion.id} className="space-y-1.5">
                    <label htmlFor={`c-${criterion.id}`} className="block text-sm font-medium text-slate-900">
                      {criterion.label}
                      {criterion.kind !== "text" ? <span className="ml-0.5 text-slate-500">*</span> : null}
                      {criterion.kind === "numeric" && criterion.weight > 1 ? (
                        <span className="ml-1.5 text-[13px] font-normal text-slate-500">weight {criterion.weight}</span>
                      ) : null}
                    </label>
                    {criterion.kind === "numeric" ? (
                      <div className="flex gap-3">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <label key={value} className="flex flex-col items-center gap-1 text-sm text-slate-900">
                            <input
                              type="radio"
                              name={`c-${criterion.id}`}
                              value={value}
                              defaultChecked={existing.byCriterion[criterion.id]?.score === value}
                              className="accent-accent"
                            />
                            {value}
                          </label>
                        ))}
                      </div>
                    ) : criterion.kind === "select" ? (
                      <select
                        id={`c-${criterion.id}`}
                        name={`c-${criterion.id}`}
                        defaultValue={existing.byCriterion[criterion.id]?.valueText ?? ""}
                        className={selectClass}
                      >
                        <option value="">Choose an option</option>
                        {criterion.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <textarea
                        id={`c-${criterion.id}`}
                        name={`c-${criterion.id}`}
                        rows={3}
                        defaultValue={existing.byCriterion[criterion.id]?.valueText ?? ""}
                        className={textareaClass}
                      />
                    )}
                    {errors[`c-${criterion.id}`] ? <p className="text-[13px] text-rose-600">{errors[`c-${criterion.id}`]}</p> : null}
                  </div>
                ))
              )}

              <div className="space-y-1.5">
                <label htmlFor="comment" className="block text-sm font-medium text-slate-900">
                  Comment
                </label>
                <textarea id="comment" name="comment" rows={4} defaultValue={existing.comment} className={textareaClass} />
                <p className="text-[13px] text-slate-500">Visible to the organizers alongside your scores.</p>
              </div>

              <button type="submit" className={`${buttonPrimary} w-full`} disabled={busy || plan.status === "closed"}>
                {assignment.status === "done" ? "Update review" : "Submit review"}
              </button>
              {plan.status === "closed" ? <p className="text-[13px] text-slate-500">This round is closed.</p> : null}
            </Form>
          </Card>
        </div>
      </main>
    </div>
  );
}
