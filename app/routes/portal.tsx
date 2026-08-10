// Speaker portal home: my submissions across events, with speaker-visible statuses.
// Queue statuses stay internal; speakers see Under review until a decision lands.
// Phase 3 adds tasks and file requests here.

import { Link } from "react-router";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/portal";
import { getDb } from "../lib/db.server";
import { requireUser } from "../lib/session.server";
import { formOpenState, speakerStatus } from "../lib/cfp.server";
import { formatDate } from "../lib/format";
import { events, forms, sessionParticipants, sessions, statuses } from "../../database/schema";
import { AppBar, Card, EmptyState, StatusBadge } from "../components/ui";

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

  return {
    user,
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
  };
}

export default function Portal({ loaderData }: Route.ComponentProps) {
  const { user, submissions, openForms } = loaderData;

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
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Your submissions</h1>
        <p className="mt-1 text-sm text-slate-500">Everything you have submitted or drafted, with its current status.</p>

        {submissions.length === 0 ? (
          <Card className="mt-5">
            <EmptyState
              message="No submissions yet."
              action={
                openForms.length > 0 ? (
                  <Link
                    to={`/submit/${openForms[0].eventSlug}/${openForms[0].slug}`}
                    className="inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
                  >
                    Submit a talk
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          [...byEvent.entries()].map(([eventId, list]) => (
            <Card key={eventId} className="mt-5">
              <div className="border-b border-slate-200 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-slate-900">{list[0].eventName}</h2>
              </div>
              <table className="w-full text-[13px]">
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
            </Card>
          ))
        )}

        {openForms.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-base font-semibold text-slate-900">Open calls for papers</h2>
            <ul className="mt-3 space-y-2">
              {openForms.map((form) => (
                <li key={form.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
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
