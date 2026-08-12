import { Form, Link } from "react-router";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { Route } from "./+types/admin";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { formatDateRange } from "../lib/format";
import { eventAccessFilter } from "../lib/events.server";
import { events } from "../../database/schema";
import {
  Card,
  EmptyState,
  PageHeader,
  TopBar,
  buttonPrimary,
  buttonSecondary,
  inputSized,
  selectSized,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Events" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const status = url.searchParams.get("status") ?? "";

  const filters = [
    // Always first: an organizer's list is their own events, plus the demo event for
    // the demo logins. Admins get the unfiltered list.
    eventAccessFilter(user),
    q ? or(like(events.name, `%${q}%`), like(events.location, `%${q}%`)) : undefined,
    status === "draft" || status === "active" || status === "archived" ? eq(events.status, status) : undefined,
  ].filter(Boolean);

  const db = getDb();
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      location: events.location,
      timezone: events.timezone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      status: events.status,
      submissionCount: sql<number>`(
        select count(*) from sessions
        where sessions.event_id = ${events.id} and sessions.is_abstract = 1 and sessions.is_draft = 0
      )`,
    })
    .from(events)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(events.createdAt))
    .all();

  return { user, rows, q, status };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const ids = form.getAll("ids").map(Number).filter((n) => Number.isInteger(n) && n > 0);

  if (ids.length === 0) return { flash: "Select at least one event first." };
  if (intent !== "archive" && intent !== "activate") return { flash: null };

  const db = getDb();
  // Bulk actions are filtered by the same rule as the list, not trusted from the
  // posted ids: the checkboxes are only as trustworthy as the browser that sent them.
  const access = eventAccessFilter(user);
  const scoped = [inArray(events.id, ids), access].filter(Boolean);
  const allowed = await db
    .select({ id: events.id })
    .from(events)
    .where(and(...scoped))
    .all();
  if (allowed.length === 0) return { flash: "None of those events are yours to change." };

  await db
    .update(events)
    .set({ status: intent === "archive" ? "archived" : "active" })
    .where(inArray(events.id, allowed.map((row) => row.id)));

  const noun = allowed.length === 1 ? "1 event" : `${allowed.length} events`;
  return { flash: intent === "archive" ? `${noun} archived.` : `${noun} made active.` };
}

export default function AdminEvents({ loaderData, actionData }: Route.ComponentProps) {
  const { user, rows, q, status } = loaderData;

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar section="Events" userName={user.name} homeTo="/admin" />

      <main className="p-6">
        <PageHeader
          title="Events"
          description="Every event you run. Open one to manage its program."
          actions={
            <>
              <Link to="/crm" className={buttonSecondary}>
                Speaker CRM
              </Link>
              <Link to="/admin/new" className={buttonPrimary}>
                Create event
              </Link>
            </>
          }
        />

        {actionData?.flash ? (
          <div role="status" className="mb-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
            {actionData.flash}
          </div>
        ) : null}

        <Card>
          <Form method="get" className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name or location"
              aria-label="Search events"
              className={`${inputSized} w-64`}
            />
            <select name="status" defaultValue={status} aria-label="Filter by status" className={`${selectSized} w-40`}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
            <button type="submit" className={buttonSecondary}>
              Apply
            </button>
            <div className="ml-auto">
              <Link
                to={`/admin/export.csv?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`}
                reloadDocument
                className={buttonSecondary}
              >
                Export CSV
              </Link>
            </div>
          </Form>

          {rows.length === 0 ? (
            <EmptyState
              message={q || status ? "No events match those filters." : "No events yet."}
              action={
                <Link to="/admin/new" className={buttonPrimary}>
                  Create event
                </Link>
              }
            />
          ) : (
            <Form method="post">
              <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
                <span className="text-[13px] text-slate-500">With selected:</span>
                <button type="submit" name="intent" value="archive" className={buttonSecondary}>
                  Archive
                </button>
                <button type="submit" name="intent" value="activate" className={buttonSecondary}>
                  Make active
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th scope="col" className="w-10 px-3 py-2">
                        <span className="sr-only">Select</span>
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">Event</th>
                      <th scope="col" className="px-3 py-2 font-medium">Dates</th>
                      <th scope="col" className="px-3 py-2 font-medium">Location</th>
                      <th scope="col" className="px-3 py-2 font-medium">Status</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Submissions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((event) => (
                      <tr key={event.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-3">
                          <input
                            type="checkbox"
                            name="ids"
                            value={event.id}
                            aria-label={`Select ${event.name}`}
                            className="accent-accent"
                          />
                        </td>
                        <td className="h-10 px-3">
                          <Link to={`/admin/${event.id}`} className="font-medium text-slate-900 hover:text-accent">
                            {event.name}
                          </Link>
                        </td>
                        <td className="px-3 text-slate-500">
                          {formatDateRange(event.startsAt, event.endsAt, event.timezone)}
                        </td>
                        <td className="px-3 text-slate-500">{event.location ?? ""}</td>
                        <td className="px-3 text-slate-500 capitalize">{event.status}</td>
                        <td className="px-3 text-right tabular-nums text-slate-900">{event.submissionCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Form>
          )}
        </Card>
      </main>
    </div>
  );
}
