// Organizer view of one submission: every answer, the speakers, the status control,
// the evaluations recorded so far, files, and a small activity trail.

import { Form, Link } from "react-router";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/event.submission";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { getFields, withColumnFallbacks, type FieldDef } from "../lib/cfp.server";
import { ensureBaseRevision, listRevisions, recordRevision, restoreRevision } from "../lib/revisions.server";
import {
  clearAiReviewOverride,
  clearAiReviews,
  listAiReviews,
  runAiReview,
  setAiReviewOverride,
} from "../lib/ai-reviews.server";
import { REVIEW_SOURCE_LABEL } from "../lib/labels";
import { getCriteria, reviewScore, type CriterionDef } from "../lib/evals.server";
import { formatBytes, formatDateTime, formatScore } from "../lib/format";
import { ROLE_LABEL } from "../lib/labels";
import {
  contacts,
  evalAssignments,
  evalPlans,
  evalScores,
  eventContacts,
  events,
  fileRequests,
  fileUploads,
  formats,
  levels,
  sessionParticipants,
  sessions,
  statuses,
  tracks,
  users,
} from "../../database/schema";
import {
  ApprovalBadge,
  Breadcrumbs,
  Card,
  Field,
  PageHeader,
  PublicStateBadge,
  StatusBadge,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  inputSized,
  selectClass,
  selectSized,
  textareaClass,
} from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.session ? `${loaderData.session.friendlyId} ${loaderData.session.title}` : "Submission" }];
}

/** Roles a person can hold on a session, in the order the picker shows them. */
const ROLE_KEYS = ["speaker", "co_speaker", "panelist", "moderator", "chairperson"] as const;

function parseAnswers(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const sessionId = Number(params.sessionId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const session = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)))
    .get();
  if (!session) throw new Response("Submission not found", { status: 404 });

  const fields: FieldDef[] = session.formId ? await getFields(session.formId, eventId) : [];
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

  const statusRows = await db
    .select({ id: statuses.id, key: statuses.key, label: statuses.label })
    .from(statuses)
    .where(eq(statuses.eventId, eventId))
    .orderBy(asc(statuses.sort))
    .all();
  const currentStatus = statusRows.find((s) => s.id === session.statusId) ?? null;

  const participants = await db
    .select({
      id: sessionParticipants.id,
      role: sessionParticipants.role,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      title: contacts.title,
      company: contacts.company,
      bio: contacts.bio,
    })
    .from(sessionParticipants)
    .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
    .where(eq(sessionParticipants.sessionId, sessionId))
    .orderBy(asc(sessionParticipants.sort), asc(sessionParticipants.id))
    .all();

  // Evaluations across all plans, with per-criterion values.
  const assignmentRows = await db
    .select({
      id: evalAssignments.id,
      planId: evalAssignments.planId,
      status: evalAssignments.status,
      planName: evalPlans.name,
      round: evalPlans.round,
      scaleType: evalPlans.scaleType,
      evaluatorName: users.name,
    })
    .from(evalAssignments)
    .innerJoin(evalPlans, eq(evalAssignments.planId, evalPlans.id))
    .innerJoin(users, eq(evalAssignments.evaluatorUserId, users.id))
    .where(eq(evalAssignments.sessionId, sessionId))
    .orderBy(asc(evalAssignments.planId), asc(evalAssignments.id))
    .all();

  const scoreRows =
    assignmentRows.length > 0
      ? await db
          .select()
          .from(evalScores)
          .where(inArray(evalScores.assignmentId, assignmentRows.map((a) => a.id)))
          .all()
      : [];

  const planIds = [...new Set(assignmentRows.map((a) => a.planId))];
  const criteriaByPlan = new Map<number, CriterionDef[]>();
  for (const planId of planIds) criteriaByPlan.set(planId, await getCriteria(planId));

  const evaluations = assignmentRows.map((assignment) => {
    const rows = scoreRows.filter((s) => s.assignmentId === assignment.id);
    const criteria = criteriaByPlan.get(assignment.planId) ?? [];
    const criteriaById = new Map(criteria.map((c) => [c.id, { kind: c.kind, weight: c.weight }]));
    const overall = rows.find((r) => r.criterionId === null);
    return {
      id: assignment.id,
      planName: assignment.planName,
      round: assignment.round,
      evaluatorName: assignment.evaluatorName,
      status: assignment.status,
      score: reviewScore(
        rows.map((r) => ({ criterionId: r.criterionId, score: r.score })),
        criteriaById
      ),
      comment: overall?.comment ?? rows.find((r) => r.comment)?.comment ?? null,
      details: rows
        .filter((r) => r.criterionId !== null)
        .map((r) => {
          const criterion = criteria.find((c) => c.id === r.criterionId);
          return {
            label: criterion?.label ?? "Criterion",
            value: criterion?.kind === "numeric" ? String(r.score) : (r.valueText ?? ""),
          };
        }),
    };
  });

  const doneScores = evaluations.filter((e) => e.status === "done" && e.score != null);
  const scoreAvg = doneScores.length > 0 ? doneScores.reduce((sum, e) => sum + (e.score ?? 0), 0) / doneScores.length : null;

  // The session's Files tab: everything uploaded against this session, newest
  // version first, with its review state and where it came from.
  const files = await db
    .select({
      id: fileUploads.id,
      filename: fileUploads.filename,
      size: fileUploads.size,
      createdAt: fileUploads.createdAt,
      version: fileUploads.version,
      approval: fileUploads.approval,
      requestTitle: fileRequests.title,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    })
    .from(fileUploads)
    .leftJoin(fileRequests, eq(fileUploads.requestId, fileRequests.id))
    .leftJoin(contacts, eq(fileUploads.contactId, contacts.id))
    .where(eq(fileUploads.sessionId, sessionId))
    .orderBy(desc(fileUploads.createdAt))
    .all();

  const revisions = await listRevisions(sessionId);
  const aiRows = await listAiReviews(sessionId);

  return {
    event,
    aiReviews: aiRows.map((row) => ({
      id: row.id,
      personaLabel: row.personaLabel,
      score: row.score,
      reviewText: row.reviewText,
      sourceLabel: REVIEW_SOURCE_LABEL[row.source] ?? "Built-in heuristic",
      createdAt: row.createdAt,
      overrideScore: row.overrideScore,
      overrideReason: row.overrideReason,
      overrideBy: row.overrideBy,
      overrideAt: row.overrideAt,
      effectiveScore: row.effectiveScore,
    })),
    // ABS-14: the AI average follows the overrides, not the raw model output.
    aiAvg: aiRows.length > 0 ? aiRows.reduce((sum, row) => sum + row.effectiveScore, 0) / aiRows.length : null,
    aiOverrides: aiRows.filter((row) => row.overrideScore != null).length,
    revisions: revisions.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      abstract: row.abstract,
      editorName: row.editorName,
      note: row.note,
      createdAt: row.createdAt,
      isCurrent: row.isCurrent,
    })),
    session: {
      id: session.id,
      friendlyId: session.friendlyId,
      title: session.title,
      abstract: session.abstract ?? "",
      publicState: session.publicState,
      isScheduled: session.startsAt != null && session.roomId != null,
      isAbstract: session.isAbstract,
      submittedAt: session.submittedAt,
      updatedAt: session.updatedAt,
      createdAt: session.createdAt,
      decisionEmailSentAt: session.decisionEmailSentAt,
    },
    fields,
    answers,
    statusRows,
    currentStatus,
    participants: participants.map((p) => ({
      id: p.id,
      role: p.role,
      name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown",
      email: p.email ?? "",
      title: p.title,
      company: p.company,
      bio: p.bio,
    })),
    evaluations,
    scoreAvg,
    scoreCount: doneScores.length,
    files,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  // The route event is authorized by the /admin/:eventId guard; the session id in
  // the path is not. Resolve it against both before any branch runs, and use only
  // the verified row, so another event's submission cannot be driven through a URL
  // this organizer is allowed to post to.
  const owned = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, Number(params.sessionId)), eq(sessions.eventId, eventId)))
    .get();
  if (!owned) throw new Response("Submission not found", { status: 404 });
  const sessionId = owned.id;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // CNT-09: organizers edit the session title and abstract here. The answers blob
  // keeps its own copies of both, so both are rewritten together and the speaker
  // portal, the submissions table, and the public widgets all read the new text.
  if (intent === "edit-content") {
    const title = String(form.get("title") ?? "").trim();
    const abstract = String(form.get("abstract") ?? "").trim();
    if (!title) return { error: "A session needs a title.", notice: null };

    const current = await db
      .select({
        answersJson: sessions.answersJson,
        title: sessions.title,
        abstract: sessions.abstract,
        submittedBy: sessions.submittedBy,
        submittedAt: sessions.submittedAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)))
      .get();
    if (!current) throw new Response("Submission not found", { status: 404 });

    const answers = parseAnswers(current.answersJson);
    if ("title" in answers) answers.title = title;
    if ("abstract" in answers) answers.abstract = abstract;

    // CNT-11: the text as submitted becomes version 1 the first time it is edited,
    // then every save appends a version attributed to whoever is signed in.
    const submitter = current.submittedBy
      ? await db
          .select({ firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email })
          .from(contacts)
          .where(eq(contacts.id, current.submittedBy))
          .get()
      : null;
    await ensureBaseRevision(
      sessionId,
      current,
      submitter ? `${submitter.firstName} ${submitter.lastName}`.trim() || submitter.email : "Submitter"
    );

    await db
      .update(sessions)
      .set({ title, abstract: abstract || null, answersJson: JSON.stringify(answers), updatedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)));

    await recordRevision(sessionId, { title, abstract: abstract || null }, { id: user.id, name: user.name });
    return { error: null, notice: "Session content saved. The previous version is in the change history." };
  }

  // ABS-14: a first pass from three AI personas. Never folded into the human
  // average: it sits in its own panel with its own number.
  if (intent === "run-ai-review") {
    const result = await runAiReview(eventId, sessionId);
    if (!result) return { error: "That submission could not be read.", notice: null };
    const { REVIEW_SOURCE_LABEL: labels } = await import("../lib/labels");
    return {
      error: null,
      notice: `AI review complete: ${result.created} personas via ${labels[result.source] ?? result.source}.`,
    };
  }

  if (intent === "clear-ai-review") {
    await clearAiReviews(sessionId);
    return { error: null, notice: "AI reviews cleared." };
  }

  // ABS-14: an organizer's own number for one persona. The model's score stays on
  // the row; only the AI panel and the AI average move.
  if (intent === "override-ai-review") {
    const reviewId = Number(form.get("reviewId") ?? 0);
    const score = Number(form.get("overrideScore") ?? 0);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return { error: "An override score has to be a whole number from 1 to 5.", notice: null };
    }
    const saved = await setAiReviewOverride(sessionId, reviewId, score, String(form.get("overrideReason") ?? ""), user.name);
    if (!saved) return { error: "That AI review does not belong to this submission.", notice: null };
    return { error: null, notice: `Score overridden to ${score} / 5. The AI average now uses it.` };
  }

  if (intent === "clear-ai-override") {
    const reviewId = Number(form.get("reviewId") ?? 0);
    const cleared = await clearAiReviewOverride(sessionId, reviewId);
    if (!cleared) return { error: "That AI review does not belong to this submission.", notice: null };
    return { error: null, notice: "Override removed. The original AI score is back in the average." };
  }

  if (intent === "restore-revision") {
    const revisionId = Number(form.get("revisionId") ?? 0);
    const restored = await restoreRevision(eventId, sessionId, revisionId, { id: user.id, name: user.name });
    if (!restored) return { error: "That version does not belong to this submission.", notice: null };
    return { error: null, notice: `Restored version ${restored.version}.` };
  }

  // CNT-12: the public content gate. Held sessions stay out of the public agenda,
  // all five embed widgets, and the calendar feed, whatever their decision status.
  if (intent === "hold-public" || intent === "publish-public") {
    await db
      .update(sessions)
      .set({ publicState: intent === "hold-public" ? "held" : "published", updatedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)));
    return {
      error: null,
      notice:
        intent === "hold-public"
          ? "Held from public. This session is off the public agenda, the widgets, and the calendar feed."
          : "Published. This session appears on the public agenda, the widgets, and the calendar feed.",
    };
  }

  // Speaker list edits live here because the agenda's conflict engine keys off them:
  // a co-speaker added late is exactly what causes a double-booking.
  if (intent === "add-speaker") {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const role = String(form.get("role") ?? "speaker");
    if (!email.includes("@")) return { error: "Enter the speaker's email address." };

    const contact = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email)).get();
    if (!contact) {
      return { error: "No contact with that email. Add them under Speakers first." };
    }
    const existing = await db
      .select({ id: sessionParticipants.id })
      .from(sessionParticipants)
      .where(and(eq(sessionParticipants.sessionId, sessionId), eq(sessionParticipants.contactId, contact.id)))
      .get();
    if (existing) return { error: "That person is already on this session." };

    const current = await db
      .select({ sort: sessionParticipants.sort })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, sessionId))
      .all();
    await db.insert(sessionParticipants).values({
      sessionId,
      contactId: contact.id,
      role: (ROLE_KEYS as readonly string[]).includes(role) ? (role as (typeof ROLE_KEYS)[number]) : "speaker",
      inviteStatus: "invited",
      sort: current.reduce((max, row) => Math.max(max, row.sort), -1) + 1,
    });
    await db.insert(eventContacts).values({ eventId, contactId: contact.id, kind: "speaker" }).onConflictDoNothing();
    await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId));
    return { error: null, notice: "Speaker added." };
  }

  if (intent === "remove-speaker") {
    const participantId = Number(form.get("participantId") ?? 0);
    await db
      .delete(sessionParticipants)
      .where(and(eq(sessionParticipants.id, participantId), eq(sessionParticipants.sessionId, sessionId)));
    return { error: null, notice: "Speaker removed." };
  }

  if (intent !== "set-status") return { error: null };

  const statusId = Number(form.get("statusId") ?? 0);
  const status = await db
    .select({ id: statuses.id, key: statuses.key, label: statuses.label })
    .from(statuses)
    .where(and(eq(statuses.eventId, eventId), eq(statuses.id, statusId)))
    .get();
  if (!status) return { error: "That status does not exist." };

  await db
    .update(sessions)
    .set({ statusId: status.id, isAbstract: status.key !== "accepted", updatedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)));

  return { error: null, notice: `Status set to ${status.label}.` };
}

export default function SubmissionDetail({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, session, revisions, aiReviews, aiAvg, aiOverrides, fields, answers, statusRows, currentStatus, participants, evaluations, scoreAvg, scoreCount, files } =
    loaderData;

  const sessionFields = fields.filter((f) => f.section === "session");
  const speakerFields = fields.filter((f) => f.section === "speaker");
  const shownKeys = new Set(fields.map((f) => f.fieldKey));
  const extraAnswers = Object.entries(answers).filter(([key, value]) => !shownKeys.has(key) && value.trim() !== "");
  const visible = (list: FieldDef[]) =>
    list.filter((field) => !field.conditional || (answers[field.conditional.fieldKey] ?? "") === field.conditional.value);

  return (
    <>
      <Breadcrumbs items={[{ to: `/admin/${params.eventId}/submissions`, label: "Submissions" }, { label: session.friendlyId }]} />

      <PageHeader
        title={session.title}
        description={`${session.friendlyId}${session.isAbstract ? "" : ", converted to session"}`}
      />

      {actionData?.error ? (
        <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {actionData.error}
        </div>
      ) : null}
      {actionData && "notice" in actionData && actionData.notice ? (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{actionData.notice}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Session content</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">
              Edits here are what the speaker portal and the public widgets show.
            </p>
            <Form method="post" className="mt-3 space-y-3">
              <input type="hidden" name="intent" value="edit-content" />
              <Field label="Title" name="title" required>
                <input id="title" name="title" type="text" defaultValue={session.title} className={inputClass} required />
              </Field>
              <Field label="Abstract" name="abstract">
                <textarea id="abstract" name="abstract" rows={6} defaultValue={session.abstract} className={textareaClass} />
              </Field>
              <button type="submit" className={buttonPrimary}>
                Save content
              </button>
            </Form>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Change history</h2>
            {revisions.length === 0 ? (
              <p className="mt-2 text-[13px] text-slate-500">
                No edits yet. Saving the content above starts the history, keeping the version that was submitted.
              </p>
            ) : (
              <ol className="mt-3 divide-y divide-slate-100">
                {revisions.map((revision) => (
                  <li key={revision.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-900">
                        Version {revision.version}
                        <span className="ml-2 font-normal text-slate-500">
                          {revision.note}
                          {revision.isCurrent ? ", current" : ""}
                        </span>
                      </p>
                      <p className="text-[13px] text-slate-500">
                        {revision.editorName}, {formatDateTime(revision.createdAt, event.timezone)}
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-slate-900">{revision.title}</p>
                      {revision.abstract ? (
                        <p className="mt-0.5 line-clamp-2 text-[13px] text-slate-500">{revision.abstract}</p>
                      ) : null}
                    </div>
                    {revision.isCurrent ? null : (
                      <Form method="post" className="shrink-0">
                        <input type="hidden" name="revisionId" value={revision.id} />
                        <button type="submit" name="intent" value="restore-revision" className={buttonSecondary}>
                          Restore
                        </button>
                      </Form>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Answers</h2>
            <dl className="mt-3 space-y-3">
              {visible(sessionFields).map((field) => (
                <div key={field.fieldKey}>
                  <dt className="text-[13px] font-medium text-slate-500">{field.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">
                    {(answers[field.fieldKey] ?? "").trim() || <span className="text-slate-400">Not answered</span>}
                  </dd>
                </div>
              ))}
              {visible(speakerFields).map((field) => (
                <div key={field.fieldKey}>
                  <dt className="text-[13px] font-medium text-slate-500">{field.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">
                    {(answers[field.fieldKey] ?? "").trim() || <span className="text-slate-400">Not answered</span>}
                  </dd>
                </div>
              ))}
              {extraAnswers.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-[13px] font-medium text-slate-500">{key}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">AI reviews</h2>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  A first pass from three personas. Advisory only: these never enter the committee average.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {aiAvg != null ? (
                  <p className="text-[13px] text-slate-500">
                    AI average <span className="font-medium tabular-nums text-slate-900">{formatScore(aiAvg)}</span> / 5
                    {aiOverrides > 0 ? (
                      <span className="ml-1">
                        ({aiOverrides} {aiOverrides === 1 ? "override" : "overrides"} applied)
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <Form method="post">
                  <button type="submit" name="intent" value="run-ai-review" className={buttonSecondary}>
                    {aiReviews.length > 0 ? "Re-run AI review" : "Run AI review"}
                  </button>
                </Form>
              </div>
            </div>

            {aiReviews.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No AI pass yet. Running one scores this abstract from three angles and writes the reasoning here.
              </p>
            ) : (
              <>
                <ul className="mt-3 divide-y divide-slate-100">
                  {aiReviews.map((review) => (
                    <li key={review.id} className="py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900">
                          {review.personaLabel}
                          <span className="ml-2 text-[13px] font-normal text-slate-500">{review.sourceLabel}</span>
                        </p>
                        <p className="text-sm tabular-nums text-slate-900">
                          {review.overrideScore != null ? (
                            <>
                              {/* The model's own number stays legible next to the human's. */}
                              <span className="text-slate-500 line-through">{review.score}</span>{" "}
                              <span className="font-medium">{review.overrideScore} / 5</span>
                            </>
                          ) : (
                            <>{review.score} / 5</>
                          )}
                        </p>
                      </div>
                      <p className="mt-1 text-sm text-slate-900">{review.reviewText}</p>

                      {review.overrideScore != null ? (
                        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <p className="text-[13px] text-slate-900">
                            <span className="font-medium">Overridden to {review.overrideScore} / 5</span> by{" "}
                            {review.overrideBy ?? "an organizer"}
                            {review.overrideAt ? `, ${formatDateTime(review.overrideAt, event.timezone)}` : ""}. AI scored{" "}
                            {review.score}.
                          </p>
                          {review.overrideReason ? (
                            <p className="mt-0.5 text-[13px] text-slate-500">Reason: {review.overrideReason}</p>
                          ) : null}
                          <Form method="post" className="mt-1">
                            <input type="hidden" name="reviewId" value={review.id} />
                            <button
                              type="submit"
                              name="intent"
                              value="clear-ai-override"
                              className="text-[13px] font-medium text-slate-500 hover:text-rose-600"
                            >
                              Remove override
                            </button>
                          </Form>
                        </div>
                      ) : null}

                      <details className="mt-2">
                        <summary className="inline-flex cursor-pointer list-none items-center text-[13px] font-medium text-accent hover:underline">
                          {review.overrideScore != null ? "Change override" : "Override"}
                        </summary>
                        <Form method="post" className="mt-2 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="reviewId" value={review.id} />
                          <div>
                            <label htmlFor={`override-score-${review.id}`} className="block text-[13px] font-medium text-slate-900">
                              Score
                            </label>
                            <select
                              id={`override-score-${review.id}`}
                              name="overrideScore"
                              defaultValue={String(review.overrideScore ?? review.score)}
                              className={`${selectSized} mt-1 w-20`}
                            >
                              {[1, 2, 3, 4, 5].map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="min-w-0 flex-1">
                            <label htmlFor={`override-reason-${review.id}`} className="block text-[13px] font-medium text-slate-900">
                              Reason (optional)
                            </label>
                            <input
                              id={`override-reason-${review.id}`}
                              name="overrideReason"
                              type="text"
                              maxLength={200}
                              defaultValue={review.overrideReason ?? ""}
                              placeholder="One line, shown next to the score"
                              className={`${inputSized} mt-1 w-full`}
                            />
                          </div>
                          <button type="submit" name="intent" value="override-ai-review" className={buttonSecondary}>
                            Save override
                          </button>
                        </Form>
                      </details>
                    </li>
                  ))}
                </ul>
                <Form method="post" className="mt-2">
                  <button type="submit" name="intent" value="clear-ai-review" className="text-[13px] font-medium text-slate-500 hover:text-rose-600">
                    Clear AI reviews
                  </button>
                </Form>
              </>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Evaluations</h2>
              {scoreAvg != null ? (
                <p className="text-[13px] text-slate-500">
                  Average <span className="font-medium tabular-nums text-slate-900">{formatScore(scoreAvg)}</span> from {scoreCount}{" "}
                  {scoreCount === 1 ? "review" : "reviews"}
                </p>
              ) : null}
            </div>

            {evaluations.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                No evaluators assigned.{" "}
                <Link to={`/admin/${params.eventId}/evaluations`} className="font-medium text-accent hover:underline">
                  Go to Evaluations
                </Link>
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {evaluations.map((evaluation) => (
                  <li key={evaluation.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {evaluation.evaluatorName}
                        <span className="ml-2 text-[13px] font-normal text-slate-500">
                          {evaluation.planName} (round {evaluation.round})
                        </span>
                      </p>
                      {evaluation.status === "done" ? (
                        <p className="text-sm tabular-nums text-slate-900">
                          {evaluation.score != null ? `${formatScore(evaluation.score)} / 5` : "Scored"}
                        </p>
                      ) : evaluation.status === "recused" ? (
                        <p className="inline-flex items-center gap-1.5 text-[13px] text-amber-700">
                          <span className="h-2 w-2 rounded-full bg-amber-600" aria-hidden="true" />
                          Recused, not counted
                        </p>
                      ) : (
                        <p className="text-[13px] text-slate-500">Pending</p>
                      )}
                    </div>
                    {evaluation.details.length > 0 ? (
                      <p className="mt-1 text-[13px] text-slate-500">
                        {evaluation.details.map((d) => `${d.label}: ${d.value || "-"}`).join(", ")}
                      </p>
                    ) : null}
                    {evaluation.comment ? <p className="mt-1 text-sm text-slate-900">{evaluation.comment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Status</h2>
            <div className="mt-2">
              <StatusBadge statusKey={currentStatus?.key ?? "pending"} label={currentStatus?.label ?? "Pending"} />
            </div>
            <Form method="post" className="mt-3 flex items-center gap-2">
              <select name="statusId" defaultValue={currentStatus?.id ?? ""} aria-label="Set status" className={selectClass}>
                {statusRows.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
              <button type="submit" name="intent" value="set-status" className={buttonPrimary}>
                Save
              </button>
            </Form>
            <p className="mt-2 text-[13px] text-slate-500">
              Decision emails are a separate step:{" "}
              <Link to={`/admin/${params.eventId}/submissions/send-decisions`} className="font-medium text-accent hover:underline">
                send them from the queues
              </Link>
              .
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Public visibility</h2>
            <div className="mt-2">
              <PublicStateBadge state={session.publicState} />
            </div>
            <p className="mt-2 text-[13px] text-slate-500">
              {session.publicState === "held"
                ? "Hidden from the public agenda, the embed widgets, and the calendar feed."
                : session.isScheduled
                  ? "Visible on the public agenda, the embed widgets, and the calendar feed."
                  : "Will appear publicly once this session is accepted and scheduled."}
            </p>
            <Form method="post" className="mt-3">
              <button
                type="submit"
                name="intent"
                value={session.publicState === "held" ? "publish-public" : "hold-public"}
                className={buttonSecondary}
              >
                {session.publicState === "held" ? "Publish to public" : "Hold from public"}
              </button>
            </Form>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Speakers</h2>
            {participants.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nobody is listed on this session yet.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {participants.map((p) => (
                  <li key={p.id}>
                    <p className="text-sm font-medium text-slate-900">
                      {p.name} <span className="font-normal text-slate-500">({ROLE_LABEL[p.role] ?? p.role})</span>
                    </p>
                    <p className="text-[13px] text-slate-500">{[p.title, p.company].filter(Boolean).join(", ")}</p>
                    <p className="text-[13px] text-slate-500">{p.email}</p>
                    <Form method="post" className="mt-0.5">
                      <input type="hidden" name="participantId" value={p.id} />
                      <button
                        type="submit"
                        name="intent"
                        value="remove-speaker"
                        className="text-[13px] font-medium text-slate-500 hover:text-rose-600"
                      >
                        Remove
                      </button>
                    </Form>
                  </li>
                ))}
              </ul>
            )}

            <Form method="post" className="mt-4 space-y-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="intent" value="add-speaker" />
              <label htmlFor="speaker-email" className="block text-[13px] font-medium text-slate-900">
                Add a speaker
              </label>
              <input
                id="speaker-email"
                name="email"
                type="email"
                placeholder="speaker@example.com"
                aria-label="Speaker email"
                className={inputClass}
              />
              <div className="flex items-center gap-2">
                <select name="role" defaultValue="speaker" aria-label="Role on this session" className={selectClass}>
                  {ROLE_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {ROLE_LABEL[key] ?? key}
                    </option>
                  ))}
                </select>
                <button type="submit" className={buttonSecondary}>
                  Add
                </button>
              </div>
              <p className="text-[13px] text-slate-500">
                Matched by email against{" "}
                <Link to={`/admin/${params.eventId}/speakers`} className="font-medium text-accent hover:underline">
                  Speakers
                </Link>
                .
              </p>
            </Form>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Files</h2>
            {files.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                No files.{" "}
                <Link to={`/admin/${params.eventId}/content/requests`} className="font-medium text-accent hover:underline">
                  Request one
                </Link>
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {files.map((file) => (
                  <li key={file.id} className="py-2">
                    <p className="text-sm">
                      <a href={`/files/${file.id}`} className="font-medium text-accent hover:underline">
                        {file.filename}
                      </a>
                      <span className="text-slate-500"> v{file.version}, {formatBytes(file.size)}</span>
                    </p>
                    <p className="text-[13px] text-slate-500">
                      {file.requestTitle ?? "Attachment"}, {`${file.firstName ?? ""} ${file.lastName ?? ""}`.trim() || "Unknown"},{" "}
                      {formatDateTime(file.createdAt, event.timezone)}
                    </p>
                    <div className="mt-1 flex items-center gap-3">
                      <ApprovalBadge approval={file.approval} />
                      <Link
                        to={`/admin/${params.eventId}/content/uploads/${file.id}`}
                        className="text-[13px] font-medium text-accent hover:underline"
                      >
                        Review
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
            <dl className="mt-2 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Created</dt>
                <dd className="text-slate-900">{formatDateTime(session.createdAt, event.timezone)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Submitted</dt>
                <dd className="text-slate-900">{session.submittedAt ? formatDateTime(session.submittedAt, event.timezone) : "-"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Last updated</dt>
                <dd className="text-slate-900">{formatDateTime(session.updatedAt, event.timezone)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Decision email</dt>
                <dd className="text-slate-900">
                  {session.decisionEmailSentAt ? `Sent ${formatDateTime(session.decisionEmailSentAt, event.timezone)}` : "Not sent"}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
