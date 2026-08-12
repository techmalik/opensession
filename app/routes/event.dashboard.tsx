import { Link } from "react-router";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Route } from "./+types/event.dashboard";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { daysUntil, formatDate, formatDateTime } from "../lib/format";
import { events, forms, sessions, statuses } from "../../database/schema";
import { Card, EmptyState, PageHeader, StatusBadge, buttonPrimary, buttonSecondary } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Dashboard" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db
    .select({ name: events.name, slug: events.slug, timezone: events.timezone, startsAt: events.startsAt })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  // Counts per status, including statuses with no submissions yet. A LEFT JOIN plus
  // GROUP BY (rather than a correlated subquery referencing statuses.id) sidesteps a
  // Drizzle/D1 quirk where a `${statuses.id}` interpolated inside a subquery on
  // `sessions` renders as a bare "id" and resolves to sessions.id instead, since
  // sessions has its own id column in scope.
  const statusCounts = await db
    .select({
      id: statuses.id,
      key: statuses.key,
      label: statuses.label,
      sort: statuses.sort,
      count: sql<number>`count(case when ${sessions.isDraft} = 0 then 1 end)`,
    })
    .from(statuses)
    .leftJoin(sessions, eq(sessions.statusId, statuses.id))
    .where(eq(statuses.eventId, eventId))
    .groupBy(statuses.id)
    .orderBy(asc(statuses.sort))
    .all();

  const recent = await db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      submittedAt: sessions.submittedAt,
      statusKey: statuses.key,
      statusLabel: statuses.label,
    })
    .from(sessions)
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(and(eq(sessions.eventId, eventId), eq(sessions.isDraft, false)))
    .orderBy(desc(sessions.submittedAt))
    .limit(8)
    .all();

  // The soonest closing published form drives the countdown.
  const openForm = await db
    .select({ id: forms.id, name: forms.name, closesAt: forms.closesAt })
    .from(forms)
    .where(and(eq(forms.eventId, eventId), eq(forms.status, "published")))
    .orderBy(asc(forms.closesAt))
    .get();

  const total = statusCounts.reduce((sum, row) => sum + row.count, 0);

  return { event, statusCounts, recent, openForm, total, eventId };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { event, statusCounts, recent, openForm, total, eventId } = loaderData;
  const closesIn = daysUntil(openForm?.closesAt ?? null);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={event.name}
        actions={
          <Link to={`/e/${event.slug}`} target="_blank" rel="noreferrer" className={buttonSecondary}>
            Public page
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="p-4">
          <p className="text-[13px] text-slate-500">Submissions</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{total}</p>
        </Card>

        <Card className="p-4">
          <p className="text-[13px] text-slate-500">Call for papers</p>
          {openForm ? (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
                {closesIn === null ? "Open" : closesIn === 0 ? "Closed" : `${closesIn}d`}
              </p>
              <p className="mt-0.5 text-[13px] text-slate-500">
                {openForm.closesAt
                  ? closesIn === 0
                    ? `Closed ${formatDate(openForm.closesAt, event.timezone)}`
                    : `Closes ${formatDate(openForm.closesAt, event.timezone)}`
                  : "No close date set"}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-400">None</p>
              <p className="mt-0.5 text-[13px] text-slate-500">No published form yet.</p>
            </>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[13px] text-slate-500">Event starts</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {event.startsAt ? formatDate(event.startsAt, event.timezone) : "Not set"}
          </p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr] [&>*]:min-w-0">
        <Card>
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">By status</h2>
          </div>
          <ul className="p-2">
            {statusCounts.map((status) => (
              <li key={status.id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-slate-50">
                <StatusBadge statusKey={status.key} label={status.label} />
                <span className="text-[13px] tabular-nums text-slate-900">{status.count}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Recent submissions</h2>
            <Link to={`/admin/${eventId}/submissions`} className="text-[13px] font-medium text-accent hover:underline">
              View all
            </Link>
          </div>

          {recent.length === 0 ? (
            <EmptyState
              message="No submissions yet. Publish a call for papers to start collecting them."
              action={
                <Link to={`/admin/${eventId}/forms`} className={buttonPrimary}>
                  Go to Forms
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="px-4 py-2 font-medium">Title</th>
                    <th scope="col" className="px-4 py-2 font-medium">Status</th>
                    <th scope="col" className="px-4 py-2 font-medium">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="h-10 px-4 font-medium text-slate-900">{row.title}</td>
                      <td className="px-4">
                        <StatusBadge statusKey={row.statusKey ?? "pending"} label={row.statusLabel ?? "Pending"} />
                      </td>
                      <td className="px-4 text-slate-500">{formatDateTime(row.submittedAt, event.timezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
