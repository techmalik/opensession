import { Form, Link } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/home";
import { getDb } from "../lib/db.server";
import { getUser } from "../lib/session.server";
import { featuredActiveEvent } from "../lib/events.server";
import { daysUntil, formatDate, formatDateRange } from "../lib/format";
import { DEMO_ACCOUNTS } from "../lib/roles";
import { forms } from "../../database/schema";

/** The public widget surfaces, linked from the landing page so a visitor never has
 *  to guess an embed URL. */
const PUBLIC_LINKS = [
  { widget: "agenda", label: "Agenda" },
  { widget: "sessions", label: "Sessions" },
  { widget: "speakers", label: "Speakers" },
  { widget: "itinerary", label: "Itinerary" },
  { widget: "gallery", label: "Speaker gallery" },
];

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

  // The featured event (Settings > Featured event), so a visitor-created event
  // cannot take over the homepage. Latest active is only the fallback.
  const row = await featuredActiveEvent();
  const event = row
    ? {
        id: row.id,
        name: row.name,
        slug: row.slug,
        tagline: row.tagline,
        description: row.description,
        location: row.location,
        timezone: row.timezone,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      }
    : undefined;

  const openForm = event
    ? await db
        .select({ slug: forms.slug, name: forms.name, closesAt: forms.closesAt })
        .from(forms)
        .where(and(eq(forms.eventId, event.id), eq(forms.status, "published")))
        .orderBy(asc(forms.closesAt))
        .get()
    : undefined;

  return { user, event, openForm: openForm ?? null, demoAccounts: DEMO_ACCOUNTS };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, event, openForm, demoAccounts } = loaderData;
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

      {user ? null : (
        <section aria-labelledby="demo-heading" className="mt-8 border-t border-slate-200 pt-6">
          <h2 id="demo-heading" className="text-base font-semibold text-slate-900">
            Try the demo
          </h2>
          <p className="mt-1 text-base text-slate-500">
            Sign in to a populated example event as any role. No password needed.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {demoAccounts.map((account) => (
              <li key={account.key}>
                <Form method="post" action={`/demo/${account.key}`}>
                  <button
                    type="submit"
                    className="flex h-full w-full flex-col items-start rounded-md border border-slate-200 bg-white px-3 py-2.5 text-left hover:border-accent hover:bg-slate-50"
                  >
                    <span className="text-base font-medium text-slate-900">{account.label}</span>
                    <span className="mt-0.5 text-[13px] text-slate-500">{account.blurb}</span>
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {event ? (
        <nav aria-label="Public program" className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-base font-semibold text-slate-900">Programme</h2>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-base">
            {PUBLIC_LINKS.map((link) => (
              <li key={link.widget}>
                <Link to={`/embed/v1/${event.slug}/${link.widget}`} className="font-medium text-accent hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={`/embed/v1/${event.slug}/calendar.ics`} className="text-slate-500 hover:text-slate-900">
                Calendar feed
              </a>
            </li>
          </ul>
        </nav>
      ) : null}

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
        <Link to="/docs/api" className="text-slate-500 hover:text-slate-900">
          API docs
        </Link>
      </nav>
    </main>
  );
}
