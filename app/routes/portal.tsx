// Speaker portal home: what needs my attention, my invitations, and my submissions.
// Queue statuses stay internal; speakers see Under review until a decision lands.

import { Form, Link } from "react-router";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/portal";
import { getDb } from "../lib/db.server";
import { requireUser } from "../lib/session.server";
import { requireSpeaker, myFileRequests, myTasks } from "../lib/portal.server";
import { formOpenState, speakerStatus } from "../lib/cfp.server";
import { formatDate } from "../lib/format";
import { ROLE_LABEL } from "../lib/labels";
import { events, forms, sessionParticipants, sessions, statuses } from "../../database/schema";
import {
  AppBar,
  Card,
  EmptyState,
  ErrorNotice,
  Notice,
  PortalNav,
  StatusBadge,
  buttonPrimary,
  buttonSecondary,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Your portal | OpenSession" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const db = getDb();

  let rows: {
    id: number;
    friendlyId: string;
    title: string;
    isDraft: boolean;
    statusKey: string | null;
    submittedAt: Date | null;
    eventId: number;
    eventName: string;
    eventSlug: string | null;
    eventTimezone: string | null;
    formId: number | null;
  }[] = [];

  let invitations: {
    participantId: number;
    sessionId: number;
    title: string;
    role: string;
    eventName: string;
    eventTimezone: string;
  }[] = [];

  if (user.contactId) {
    const participantSessionIds = (
      await db
        .select({ sessionId: sessionParticipants.sessionId })
        .from(sessionParticipants)
        .where(eq(sessionParticipants.contactId, user.contactId))
        .all()
    ).map((r) => r.sessionId);

    if (participantSessionIds.length > 0) {
      rows = await db
        .select({
          id: sessions.id,
          friendlyId: sessions.friendlyId,
          title: sessions.title,
          isDraft: sessions.isDraft,
          statusKey: statuses.key,
          submittedAt: sessions.submittedAt,
          eventId: sessions.eventId,
          eventName: events.name,
          eventSlug: events.slug,
          eventTimezone: events.timezone,
          formId: sessions.formId,
        })
        .from(sessions)
        .innerJoin(events, eq(sessions.eventId, events.id))
        .leftJoin(statuses, eq(sessions.statusId, statuses.id))
        .where(inArray(sessions.id, participantSessionIds))
        .orderBy(desc(sessions.updatedAt))
        .all();
    }

    invitations = await db
      .select({
        participantId: sessionParticipants.id,
        sessionId: sessions.id,
        title: sessions.title,
        role: sessionParticipants.role,
        eventName: events.name,
        eventTimezone: events.timezone,
      })
      .from(sessionParticipants)
      .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
      .innerJoin(events, eq(sessions.eventId, events.id))
      .where(and(eq(sessionParticipants.contactId, user.contactId), eq(sessionParticipants.inviteStatus, "invited")))
      .orderBy(asc(sessions.id))
      .all();
  }

  // Which forms are still open decides whether an Edit link appears.
  const formIds = [...new Set(rows.map((r) => r.formId).filter((id): id is number => id != null))];
  const formRows =
    formIds.length > 0
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
          .where(inArray(forms.id, formIds))
          .all()
      : [];
  const formById = new Map(formRows.map((f) => [f.id, { ...f, open: formOpenState(f) === "open" }]));

  // Open calls the speaker could still submit to.
  const openForms = await db
    .select({
      id: forms.id,
      name: forms.name,
      slug: forms.slug,
      closesAt: forms.closesAt,
      status: forms.status,
      opensAt: forms.opensAt,
      eventName: events.name,
      eventSlug: events.slug,
      eventTimezone: events.timezone,
    })
    .from(forms)
    .innerJoin(events, eq(forms.eventId, events.id))
    .where(and(eq(forms.status, "published"), eq(events.status, "active")))
    .orderBy(asc(forms.closesAt))
    .all();

  const tasks = user.contactId ? await myTasks(user.contactId) : [];
  const requests = user.contactId ? await myFileRequests(user.contactId) : [];

  return {
    user,
    invitations,
    submissions: rows.map((row) => {
      const form = row.formId != null ? formById.get(row.formId) : undefined;
      return {
        ...row,
        status: speakerStatus(row.statusKey, row.isDraft),
        editable: Boolean(form?.open && (row.isDraft || form.allowEditAfterSubmit)),
        formSlug: form?.slug ?? null,
      };
    }),
    openForms: openForms.filter((f) => formOpenState(f) === "open"),
    openTasks: tasks.filter((task) => !task.done).length,
    openFiles: requests.filter((request) => request.latestUploadId == null).length,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { contactId } = await requireSpeaker(request);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const participantId = Number(form.get("participantId") ?? 0);
  if (intent !== "confirm" && intent !== "decline") return { error: null };

  // The row must be this speaker's own invitation.
  const row = await db
    .select({ id: sessionParticipants.id })
    .from(sessionParticipants)
    .where(and(eq(sessionParticipants.id, participantId), eq(sessionParticipants.contactId, contactId)))
    .get();
  if (!row) return { error: "That invitation is not yours." };

  await db
    .update(sessionParticipants)
    .set({ inviteStatus: intent === "confirm" ? "confirmed" : "declined" })
    .where(eq(sessionParticipants.id, row.id));

  return { error: null, notice: intent === "confirm" ? "Participation confirmed." : "Participation declined." };
}

export default function Portal({ loaderData, actionData }: Route.ComponentProps) {
  const { user, submissions, openForms, invitations, openTasks, openFiles } = loaderData;

  const byEvent = new Map<number, typeof submissions>();
  for (const submission of submissions) {
    const list = byEvent.get(submission.eventId) ?? [];
    list.push(submission);
    byEvent.set(submission.eventId, list);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="OpenSession" userName={user.name} homeTo="/portal" />

      <main className="mx-auto w-full max-w-[960px] px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Welcome, {user.name}</h1>
        <p className="mt-1 text-sm text-slate-500">Your sessions, tasks, files, and profile for every event you speak at.</p>

        <div className="mt-5">
          <PortalNav current="/portal" />
        </div>

        {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
        {actionData && "notice" in actionData && actionData.notice ? <Notice>{actionData.notice}</Notice> : null}

        {openTasks > 0 || openFiles > 0 ? (
          <div className="mb-5 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Card className="p-4">
              <p className="text-2xl font-semibold tabular-nums text-slate-900">{openTasks}</p>
              <p className="mt-0.5 text-[13px] text-slate-500">{openTasks === 1 ? "task" : "tasks"} still to do</p>
              <Link to="/portal/tasks" className={`${buttonSecondary} mt-3`}>
                Open my tasks
              </Link>
            </Card>
            <Card className="p-4">
              <p className="text-2xl font-semibold tabular-nums text-slate-900">{openFiles}</p>
              <p className="mt-0.5 text-[13px] text-slate-500">{openFiles === 1 ? "file" : "files"} not uploaded yet</p>
              <Link to="/portal/files" className={`${buttonSecondary} mt-3`}>
                Open my files
              </Link>
            </Card>
          </div>
        ) : null}

        {invitations.length > 0 ? (
          <Card className="mb-5">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">Invitations</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">Let the organizers know whether you can take part.</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {invitations.map((invitation) => (
                <li key={invitation.participantId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{invitation.title}</p>
                    <p className="text-[13px] text-slate-500">
                      {invitation.eventName}, as {ROLE_LABEL[invitation.role] ?? invitation.role}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Form method="post">
                      <input type="hidden" name="participantId" value={invitation.participantId} />
                      <button type="submit" name="intent" value="confirm" className={buttonPrimary}>
                        Confirm
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="participantId" value={invitation.participantId} />
                      <button type="submit" name="intent" value="decline" className={buttonSecondary}>
                        Decline
                      </button>
                    </Form>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <h2 className="text-base font-semibold text-slate-900">My submissions</h2>

        {submissions.length === 0 ? (
          <Card className="mt-3">
            <EmptyState
              message="No submissions yet."
              action={
                openForms.length > 0 ? (
                  <Link to={`/submit/${openForms[0].eventSlug}/${openForms[0].slug}`} className={buttonPrimary}>
                    Submit a talk
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          [...byEvent.entries()].map(([eventId, list]) => (
            <Card key={eventId} className="mt-3">
              <div className="border-b border-slate-200 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-slate-900">{list[0].eventName}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th scope="col" className="px-4 py-2 font-medium">ID</th>
                      <th scope="col" className="px-4 py-2 font-medium">Title</th>
                      <th scope="col" className="px-4 py-2 font-medium">Status</th>
                      <th scope="col" className="px-4 py-2 font-medium">Submitted</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="h-10 px-4 font-mono text-xs text-slate-500">{row.friendlyId}</td>
                        <td className="px-4 font-medium text-slate-900">
                          {row.isDraft && row.formSlug ? (
                            <Link to={`/submit/${row.eventSlug}/${row.formSlug}?sid=${row.id}&step=1`} className="hover:text-accent">
                              {row.title || "Untitled draft"}
                            </Link>
                          ) : (
                            <Link to={`/portal/submissions/${row.id}`} className="hover:text-accent">
                              {row.title}
                            </Link>
                          )}
                        </td>
                        <td className="px-4">
                          <StatusBadge statusKey={row.status.key} label={row.status.label} />
                        </td>
                        <td className="px-4 text-slate-500">
                          {row.submittedAt ? formatDate(row.submittedAt, row.eventTimezone ?? undefined) : "Draft"}
                        </td>
                        <td className="px-4 text-right">
                          {row.isDraft && row.formSlug ? (
                            <Link
                              to={`/submit/${row.eventSlug}/${row.formSlug}?sid=${row.id}&step=1`}
                              className="font-medium text-accent hover:underline"
                            >
                              Resume
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-3">
                              <Link to={`/portal/submissions/${row.id}`} className="font-medium text-accent hover:underline">
                                View
                              </Link>
                              {row.editable && row.formSlug ? (
                                <Link
                                  to={`/submit/${row.eventSlug}/${row.formSlug}?sid=${row.id}&step=1`}
                                  className="font-medium text-accent hover:underline"
                                >
                                  Edit
                                </Link>
                              ) : null}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
        )}

        {openForms.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-base font-semibold text-slate-900">Open calls for papers</h2>
            <ul className="mt-3 space-y-2">
              {openForms.map((form) => (
                <li
                  key={form.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {form.name}, {form.eventName}
                    </p>
                    <p className="text-[13px] text-slate-500">
                      {form.closesAt ? `Closes ${formatDate(form.closesAt, form.eventTimezone ?? undefined)}` : "Open"}
                    </p>
                  </div>
                  <Link to={`/submit/${form.eventSlug}/${form.slug}`} className="text-sm font-medium text-accent hover:underline">
                    Submit a talk
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
