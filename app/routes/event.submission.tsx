// Organizer view of one submission: every answer, the speakers, the status control,
// the evaluations recorded so far, files, and a small activity trail.

import { Form, Link } from "react-router";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/event.submission";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { getFields, withColumnFallbacks, type FieldDef } from "../lib/cfp.server";
import { getCriteria, reviewScore, type CriterionDef } from "../lib/evals.server";
import { formatDateTime, formatScore } from "../lib/format";
import { ROLE_LABEL } from "../lib/labels";
import {
  contacts,
  evalAssignments,
  evalPlans,
  evalScores,
  events,
  fileUploads,
  formats,
  levels,
  sessionParticipants,
  sessions,
  statuses,
  tracks,
  users,
} from "../../database/schema";
import { Card, PageHeader, StatusBadge, buttonPrimary, selectClass } from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.session ? `${loaderData.session.friendlyId} ${loaderData.session.title}` : "Submission" }];
}

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

  const files = await db
    .select({ id: fileUploads.id, filename: fileUploads.filename, size: fileUploads.size, createdAt: fileUploads.createdAt, version: fileUploads.version })
    .from(fileUploads)
    .where(eq(fileUploads.sessionId, sessionId))
    .orderBy(asc(fileUploads.createdAt))
    .all();

  return {
    event,
    session: {
      id: session.id,
      friendlyId: session.friendlyId,
      title: session.title,
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
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const sessionId = Number(params.sessionId);
  const db = getDb();

  const form = await request.formData();
  if (String(form.get("intent")) !== "set-status") return { error: null };

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
  const { event, session, fields, answers, statusRows, currentStatus, participants, evaluations, scoreAvg, scoreCount, files } =
    loaderData;

  const sessionFields = fields.filter((f) => f.section === "session");
  const speakerFields = fields.filter((f) => f.section === "speaker");
  const shownKeys = new Set(fields.map((f) => f.fieldKey));
  const extraAnswers = Object.entries(answers).filter(([key, value]) => !shownKeys.has(key) && value.trim() !== "");
  const visible = (list: FieldDef[]) =>
    list.filter((field) => !field.conditional || (answers[field.conditional.fieldKey] ?? "") === field.conditional.value);

  return (
    <>
      <div className="mb-2 text-[13px]">
        <Link to={`/admin/${params.eventId}/submissions`} className="text-slate-500 hover:text-slate-900">
          Submissions
        </Link>
        <span className="mx-1 text-slate-400">/</span>
        <span className="text-slate-900">{session.friendlyId}</span>
      </div>

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

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
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
            <h2 className="text-sm font-semibold text-slate-900">Speakers</h2>
            <ul className="mt-2 space-y-3">
              {participants.map((p) => (
                <li key={p.id}>
                  <p className="text-sm font-medium text-slate-900">
                    {p.name} <span className="font-normal text-slate-500">({ROLE_LABEL[p.role] ?? p.role})</span>
                  </p>
                  <p className="text-[13px] text-slate-500">
                    {[p.title, p.company].filter(Boolean).join(", ")}
                  </p>
                  <p className="text-[13px] text-slate-500">{p.email}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Files</h2>
            {files.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No files.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {files.map((file) => (
                  <li key={file.id} className="text-sm">
                    <a href={`/files/${file.id}`} className="font-medium text-accent hover:underline">
                      {file.filename}
                    </a>
                    <span className="text-slate-500">
                      {" "}
                      v{file.version}, {Math.max(1, Math.round(file.size / 1024))} KB
                    </span>
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
