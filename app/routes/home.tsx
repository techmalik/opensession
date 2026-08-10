import { Link } from "react-router";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Route } from "./+types/home";
import { getDb } from "../lib/db.server";
import { getUser } from "../lib/session.server";
import { daysUntil, formatDate, formatDateRange } from "../lib/format";
import { events, forms } from "../../database/schema";

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.event?.name;
  return [
    { title: name ? `${name} | OpenSession` : "OpenSession" },
    { name: "description", content: "Speaker and content management for conferences." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  const db = getDb();

  // The most recently created active event is the one this install is "about".
  const event = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      tagline: events.tagline,
      description: events.description,
      location: events.location,
      timezone: events.timezone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
    })
    .from(events)
    .where(eq(events.status, "active"))
    .orderBy(desc(events.createdAt))
    .get();

  const openForm = event
    ? await db
        .select({ slug: forms.slug, name: forms.name, closesAt: forms.closesAt })
        .from(forms)
        .where(and(eq(forms.eventId, event.id), eq(forms.status, "published")))
        .orderBy(asc(forms.closesAt))
        .get()
    : undefined;

  return { user, event, openForm: openForm ?? null };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, event, openForm } = loaderData;
  const closesIn = daysUntil(openForm?.closesAt ?? null);
  // daysUntil returns 0 only for past dates (a close later today still counts as 1).
  const formClosed = openForm?.closesAt != null && closesIn === 0;

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-16">
      <p className="text-[13px] font-medium tracking-wide text-slate-500">OpenSession</p>

      {event ? (
        <>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{event.name}</h1>
          {event.tagline ? <p className="mt-2 text-base text-slate-500">{event.tagline}</p> : null}

          <dl className="mt-6 space-y-1 text-base text-slate-900">
            <div className="flex gap-2">
              <dt className="text-slate-500">Dates:</dt>
              <dd>{formatDateRange(event.startsAt, event.endsAt, event.timezone)}</dd>
            </div>
            {event.location ? (
              <div className="flex gap-2">
                <dt className="text-slate-500">Location:</dt>
                <dd>{event.location}</dd>
              </div>
            ) : null}
          </dl>

          {event.description ? <p className="mt-6 text-base leading-relaxed text-slate-900">{event.description}</p> : null}

          {openForm && !formClosed ? (
            <div className="mt-8 rounded-lg border border-slate-200 p-4">
              <h2 className="text-base font-semibold text-slate-900">{openForm.name}</h2>
              <p className="mt-1 text-base text-slate-500">
                {openForm.closesAt
                  ? `Closes ${formatDate(openForm.closesAt, event.timezone)}, ${closesIn} days left`
                  : "Open for submissions"}
              </p>
              <Link
                to={`/cfp/${event.slug}`}
                className="mt-3 inline-flex h-11 items-center justify-center rounded-md bg-accent px-4 text-base font-medium text-white hover:bg-accent-hover"
              >
                Submit a talk
              </Link>
            </div>
          ) : openForm && formClosed ? (
            <p className="mt-8 text-base text-slate-500">
              Form closed {formatDate(openForm.closesAt, event.timezone)}.
            </p>
          ) : (
            <p className="mt-8 text-base text-slate-500">Submissions are not open right now.</p>
          )}
        </>
      ) : (
        <>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">
            Speaker and content management for conferences
          </h1>
          <p className="mt-2 text-base text-slate-500">No event has been created yet.</p>
          <Link
            to="/admin/new"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-accent px-4 text-base font-medium text-white hover:bg-accent-hover"
          >
            Create the first event
          </Link>
        </>
      )}

      <nav className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-6 text-base">
        {user && (user.role === "admin" || user.role === "organizer") ? (
          <Link to="/admin" className="font-medium text-accent hover:underline">
            Organizer dashboard
          </Link>
        ) : user ? null : (
          <Link to="/login" className="font-medium text-accent hover:underline">
            Organizer sign in
          </Link>
        )}
        <Link to="/portal" className="text-slate-500 hover:text-slate-900">
          Speaker portal
        </Link>
        <Link to="/api-docs" className="text-slate-500 hover:text-slate-900">
          API docs
        </Link>
      </nav>
    </main>
  );
}
