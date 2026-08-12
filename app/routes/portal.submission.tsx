// A speaker's read-only view of one submission. Editing hands off to the public form
// flow while the form is open; after the close date the page states that editing is
// locked (the server enforces it either way).

import { Link } from "react-router";
import { asc, eq } from "drizzle-orm";
import type { Route } from "./+types/portal.submission";
import { getDb } from "../lib/db.server";
import { requireUser } from "../lib/session.server";
import { formOpenState, getFields, speakerStatus, withColumnFallbacks, type FieldDef } from "../lib/cfp.server";
import { formatDate, formatDateTime } from "../lib/format";
import { contacts, events, fileUploads, formats, forms, levels, sessionParticipants, sessions, statuses, tracks } from "../../database/schema";
import { AppBar, Breadcrumbs, Card, StatusBadge } from "../components/ui";
import { ROLE_LABEL } from "../lib/labels";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.session ? `${loaderData.session.title} | Your portal` : "Your portal" }];
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
  const user = await requireUser(request);
  const sessionId = Number(params.sessionId);
  if (!Number.isInteger(sessionId) || !user.contactId) throw new Response("Not found", { status: 404 });

  const db = getDb();
  const session = await db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) throw new Response("Not found", { status: 404 });

  // Owner or listed participant only. Anyone else gets the same 404 as a missing row.
  const participantRows = await db
    .select({
      id: sessionParticipants.id,
      contactId: sessionParticipants.contactId,
      role: sessionParticipants.role,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      company: contacts.company,
    })
    .from(sessionParticipants)
    .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
    .where(eq(sessionParticipants.sessionId, sessionId))
    .orderBy(asc(sessionParticipants.sort), asc(sessionParticipants.id))
    .all();

  const isMine = session.submittedBy === user.contactId || participantRows.some((p) => p.contactId === user.contactId);
  if (!isMine) throw new Response("Not found", { status: 404 });

  const event = await db
    .select({ id: events.id, name: events.name, slug: events.slug, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, session.eventId))
    .get();
  if (!event) throw new Response("Not found", { status: 404 });

  const statusRow = session.statusId
    ? await db.select({ key: statuses.key, label: statuses.label }).from(statuses).where(eq(statuses.id, session.statusId)).get()
    : null;

  const form = session.formId
    ? await db
        .select({
          id: forms.id,
          slug: forms.slug,
          status: forms.status,
          opensAt: forms.opensAt,
          closesAt: forms.closesAt,
          allowEditAfterSubmit: forms.allowEditAfterSubmit,
        })
        .from(forms)
        .where(eq(forms.id, session.formId))
        .get()
    : null;

  const fields: FieldDef[] = form ? await getFields(form.id, event.id) : [];
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

  const files = await db
    .select({ id: fileUploads.id, filename: fileUploads.filename, size: fileUploads.size, createdAt: fileUploads.createdAt })
    .from(fileUploads)
    .where(eq(fileUploads.sessionId, sessionId))
    .orderBy(asc(fileUploads.createdAt))
    .all();

  const formOpen = form ? formOpenState(form) === "open" : false;
  const editable = formOpen && (session.isDraft || (form?.allowEditAfterSubmit ?? false));

  const url = new URL(request.url);

  return {
    user,
    event,
    session: {
      id: session.id,
      friendlyId: session.friendlyId,
      title: session.title,
      isDraft: session.isDraft,
      submittedAt: session.submittedAt,
      updatedAt: session.updatedAt,
    },
    status: speakerStatus(statusRow?.key ?? null, session.isDraft),
    fields,
    answers,
    participants: participantRows.map((p) => ({
      id: p.id,
      role: p.role,
      name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown",
      company: p.company,
    })),
    files,
    editable,
    formOpen,
    formSlug: form?.slug ?? null,
    formClosesAt: form?.closesAt ?? null,
    saved: url.searchParams.get("saved") === "1",
  };
}

export default function PortalSubmission({ loaderData }: Route.ComponentProps) {
  const { user, event, session, status, fields, answers, participants, files, editable, formOpen, formSlug, formClosesAt, saved } =
    loaderData;

  const sessionFields = fields.filter((f) => f.section === "session");
  const speakerFields = fields.filter((f) => f.section === "speaker");
  const visible = (list: FieldDef[]) =>
    list.filter((field) => !field.conditional || (answers[field.conditional.fieldKey] ?? "") === field.conditional.value);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="OpenSession" userName={user.name} homeTo="/portal" />

      <main className="mx-auto w-full max-w-[960px] px-6 py-8">
        <Breadcrumbs items={[{ to: "/portal", label: "Your submissions" }, { label: session.friendlyId }]} />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{session.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <span className="font-mono text-xs">{session.friendlyId}</span>
              <StatusBadge statusKey={status.key} label={status.label} />
              <span>{event.name}</span>
            </p>
          </div>
          {editable && formSlug ? (
            <Link
              to={`/submit/${event.slug}/${formSlug}?sid=${session.id}&step=1`}
              className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
            >
              Edit submission
            </Link>
          ) : null}
        </div>

        {saved ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">Changes saved.</div>
        ) : null}

        {!editable ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
            {formOpen
              ? "Editing after submitting is not enabled for this form."
              : `Editing is closed${formClosesAt ? `: the form closed ${formatDate(formClosesAt, event.timezone)}` : ""}. Your submission is read-only.`}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Session details</h2>
            <dl className="mt-3 space-y-3">
              {visible(sessionFields).map((field) => (
                <div key={field.fieldKey}>
                  <dt className="text-[13px] font-medium text-slate-500">{field.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">
                    {(answers[field.fieldKey] ?? "").trim() || <span className="text-slate-400">Not answered</span>}
                  </dd>
                </div>
              ))}
              {visible(speakerFields).length > 0 ? (
                <>
                  <div className="border-t border-slate-100 pt-3">
                    <dt className="text-[13px] font-semibold text-slate-900">Speaker details</dt>
                  </div>
                  {visible(speakerFields).map((field) => (
                    <div key={field.fieldKey}>
                      <dt className="text-[13px] font-medium text-slate-500">{field.label}</dt>
                      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-slate-900">
                        {(answers[field.fieldKey] ?? "").trim() || <span className="text-slate-400">Not answered</span>}
                      </dd>
                    </div>
                  ))}
                </>
              ) : null}
            </dl>
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-900">Speakers</h2>
              <ul className="mt-2 space-y-2">
                {participants.map((p) => (
                  <li key={p.id} className="text-sm text-slate-900">
                    {p.name}
                    <span className="text-slate-500">
                      {" "}
                      ({ROLE_LABEL[p.role] ?? p.role}
                      {p.company ? `, ${p.company}` : ""})
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-900">Files</h2>
              {files.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No files uploaded.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {files.map((file) => (
                    <li key={file.id} className="text-sm">
                      <a href={`/files/${file.id}`} className="font-medium text-accent hover:underline">
                        {file.filename}
                      </a>
                      <span className="text-slate-500"> ({Math.max(1, Math.round(file.size / 1024))} KB)</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-900">Timeline</h2>
              <dl className="mt-2 space-y-1.5 text-[13px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Submitted</dt>
                  <dd className="text-slate-900">
                    {session.submittedAt ? formatDateTime(session.submittedAt, event.timezone) : "Draft"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Last updated</dt>
                  <dd className="text-slate-900">{formatDateTime(session.updatedAt, event.timezone)}</dd>
                </div>
              </dl>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
