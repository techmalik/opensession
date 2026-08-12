import { Form, Link, NavLink, Outlet, isRouteErrorResponse, useMatches, useRouteError } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/event";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { canAccessEvent, eventAccessFilter } from "../lib/events.server";
import { CommandPalette } from "../components/palette";
import { events } from "../../database/schema";

/** Runs before every loader and action under /admin/:eventId, including the resource
 *  routes (CSV, ZIP, palette.json). A loader guard alone would not do: actions run
 *  first, so a POST to a child route would have written its change before this
 *  route's loader ever got the chance to say no. */
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request, params }, next) => {
    const user = await requireOrganizer(request);
    const eventId = Number(params.eventId);
    if (!Number.isInteger(eventId)) throw new Response("Event not found", { status: 404 });

    const event = await getDb()
      .select({ slug: events.slug, createdBy: events.createdBy })
      .from(events)
      .where(eq(events.id, eventId))
      .get();
    if (!event) throw new Response("Event not found", { status: 404 });
    if (!canAccessEvent(user, event)) {
      throw new Response("This event belongs to another organizer.", { status: 403 });
    }

    return next();
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  const eventId = Number(params.eventId);
  if (!Number.isInteger(eventId)) throw new Response("Event not found", { status: 404 });

  const db = getDb();
  const event = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      timezone: events.timezone,
      status: events.status,
      createdBy: events.createdBy,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .get();

  if (!event) throw new Response("Event not found", { status: 404 });
  if (!canAccessEvent(user, event)) {
    throw new Response("This event belongs to another organizer.", { status: 403 });
  }

  // The event switcher offers only what this organizer may open.
  const access = eventAccessFilter(user);
  const allEvents = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(access ? and(access) : undefined)
    .orderBy(asc(events.name))
    .all();

  return { user, event, allEvents };
}

const NAV_GROUPS: { label: string | null; items: { to: string; label: string; end?: boolean }[] }[] = [
  { label: null, items: [{ to: "", label: "Dashboard", end: true }] },
  {
    label: "Program",
    items: [
      { to: "submissions", label: "Submissions" },
      { to: "forms", label: "Forms" },
      { to: "evaluations", label: "Evaluations" },
      { to: "agenda", label: "Agenda" },
      { to: "speakers", label: "Speakers" },
      { to: "content", label: "Content" },
    ],
  },
  {
    label: null,
    items: [
      { to: "portals", label: "Portals" },
      { to: "communications", label: "Communications" },
      { to: "embeds", label: "Embeds" },
      { to: "settings", label: "Settings" },
    ],
  },
];

/** Pages whose tables genuinely need the full content area. Everything else reads at
 *  960px, so a settings form and a dashboard are not 1200px of white space with a
 *  paragraph in the corner. Route ids, not paths: a renamed URL cannot silently drop
 *  a table back to the reading width. */
const WIDE_ROUTES = new Set([
  "routes/event.submissions",
  "routes/event.speakers",
  "routes/event.agenda",
  "routes/event.content.review",
  "routes/event.plan.results",
  "routes/event.agenda.assist",
]);

export default function EventShell({ loaderData }: Route.ComponentProps) {
  const { user, event, allEvents } = loaderData;
  const base = `/admin/${event.id}`;
  const matches = useMatches();
  const wide = WIDE_ROUTES.has(matches[matches.length - 1]?.id ?? "");

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex">
        <aside className="fixed inset-y-0 left-0 flex w-[232px] flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-3">
            <details key={event.id} className="group relative">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-1.5 hover:bg-slate-50">
                <span className="truncate text-sm font-medium text-slate-900">{event.name}</span>
                <svg
                  className="ml-2 h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <div className="absolute left-0 right-0 z-10 mt-1 rounded-md border border-slate-200 bg-white py-1 shadow-sm">
                {allEvents.map((option) => (
                  <Link
                    key={option.id}
                    to={`/admin/${option.id}`}
                    className={`block truncate px-3 py-1.5 text-[13px] hover:bg-slate-50 ${
                      option.id === event.id ? "font-medium text-accent" : "text-slate-900"
                    }`}
                  >
                    {option.name}
                  </Link>
                ))}
                <div className="my-1 border-t border-slate-100" />
                <Link to="/admin" className="block px-3 py-1.5 text-[13px] text-slate-500 hover:bg-slate-50">
                  All events
                </Link>
                <Link to="/admin/new" className="block px-3 py-1.5 text-[13px] text-slate-500 hover:bg-slate-50">
                  Create event
                </Link>
              </div>
            </details>
            <div className="mt-2">
              <CommandPalette base={base} />
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-2">
            {NAV_GROUPS.map((group, index) => (
              <div key={index} className={index > 0 ? "mt-4" : ""}>
                {group.label ? (
                  <p className="px-2 pb-1 text-xs font-medium tracking-wide text-slate-400">{group.label}</p>
                ) : null}
                {group.items.map((item) => (
                  <NavLink
                    key={item.label}
                    to={item.to ? `${base}/${item.to}` : base}
                    end={item.end}
                    className={({ isActive }) =>
                      `block rounded-md px-2 py-1.5 text-[13px] ${
                        isActive ? "bg-slate-50 font-medium text-accent" : "text-slate-900 hover:bg-slate-50"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            ))}

            {/* Everything an organizer reaches from an event but that is not scoped
                to it: the org-level CRM, the event's own public page, and the API
                reference. Absolute paths, so they sit outside the NavLink groups. */}
            <div className="mt-4 border-t border-slate-100 pt-3">
              {[
                { to: "/crm", label: "Speaker CRM" },
                ...(event.slug ? [{ to: `/e/${event.slug}`, label: "Public page" }] : []),
                { to: "/docs/api", label: "API docs" },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="block rounded-md px-2 py-1.5 text-[13px] text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>

          <div className="border-t border-slate-200 p-3">
            <p className="truncate px-2 text-[13px] text-slate-900">{user.name}</p>
            <p className="truncate px-2 text-xs capitalize text-slate-500">{user.role}</p>
            <Form method="post" action="/logout" className="mt-1.5 px-2">
              <button type="submit" className="text-[13px] font-medium text-slate-500 hover:text-slate-900">
                Sign out
              </button>
            </Form>
          </div>
        </aside>

        {/* flex-1 with min-w-0, not w-full: w-full is 100% of the row and the
            232px sidebar offset is added on top of it, so a wide table pushed the
            whole page into a horizontal scroll and the fixed sidebar slid away. */}
        <main className="ml-[232px] min-w-0 flex-1 p-6">
          <div className={wide ? "" : "mx-auto w-full max-w-[960px]"}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {is404 ? "Event not found" : "Something went wrong"}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {is404
          ? "That event does not exist, or it was deleted."
          : isRouteErrorResponse(error)
            ? error.data || error.statusText
            : "Try again, or go back to your events."}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link to="/admin" className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50">
          Back to events
        </Link>
        <Link to="/" className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50">
          Go to the start
        </Link>
      </div>
    </main>
  );
}
