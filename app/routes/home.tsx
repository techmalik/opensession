import { Form, Link } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/home";
import { getDb } from "../lib/db.server";
import { getUser } from "../lib/session.server";
import { featuredActiveEvent } from "../lib/events.server";
import { landingFor, DEMO_ACCOUNTS } from "../lib/roles";
import { formatDateRange } from "../lib/format";
import { eventCfpStatus } from "../components/event-public";
import { forms } from "../../database/schema";

// The front door. A product page, not an event page: what OpenSession is, a way to
// try it without an account, and one featured event linking through to its own
// public page at /e/:eventSlug. A specific event's overview lives there now, not
// here, so no single event owns the homepage.

export function meta(): Route.MetaDescriptors {
  return [
    { title: "OpenSession" },
    { name: "description", content: "Open-source speaker and content management for conferences." },
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
        name: row.name,
        slug: row.slug,
        location: row.location,
        timezone: row.timezone,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      }
    : undefined;

  const openForm = event
    ? await db
        .select({ name: forms.name, closesAt: forms.closesAt })
        .from(forms)
        .where(and(eq(forms.eventId, row!.id), eq(forms.status, "published")))
        .orderBy(asc(forms.closesAt))
        .get()
    : undefined;

  return { user, event, openForm: openForm ?? null, demoAccounts: DEMO_ACCOUNTS };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { user, event, openForm, demoAccounts } = loaderData;

  return (
    <>
      <header className="border-b border-slate-200">
        <div className="mx-auto flex w-full max-w-[720px] items-center justify-between px-6 py-4">
          <Link to="/" className="text-sm font-semibold tracking-tight text-slate-900">
            OpenSession
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {user ? (
              <Link to={landingFor(user.role)} className="font-medium text-accent hover:underline">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-slate-500 hover:text-slate-900">
                  Sign in
                </Link>
                <Link to="/signup" className="font-medium text-accent hover:underline">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] px-6 py-16">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">
          Open-source speaker and content management for conferences.
        </h1>
        <p className="mt-2 text-base text-slate-500">
          Call for papers, review, agenda scheduling, and public embeds, self-hosted and open source.
        </p>

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

        <section aria-labelledby="featured-heading" className="mt-8 border-t border-slate-200 pt-6">
          <h2 id="featured-heading" className="text-base font-semibold text-slate-900">
            Featured event
          </h2>

          {event ? (
            <div className="mt-3 rounded-lg border border-slate-200 p-4">
              <Link to={`/e/${event.slug}`} className="text-lg font-semibold text-slate-900 hover:text-accent">
                {event.name}
              </Link>
              <p className="mt-1 text-[13px] text-slate-500">
                {[formatDateRange(event.startsAt, event.endsAt, event.timezone), event.location]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p className="mt-2 text-[13px] text-slate-900">{eventCfpStatus(event, openForm)}</p>
              <Link
                to={`/e/${event.slug}`}
                className="mt-3 inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50"
              >
                View event
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-base text-slate-500">
              No event has been created yet.{" "}
              <Link to="/admin/new" className="font-medium text-accent hover:underline">
                Create the first event
              </Link>
              .
            </p>
          )}
        </section>

        <nav className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-6 text-sm">
          {event ? (
            <>
              <Link to={`/embed/v1/${event.slug}/agenda`} className="font-medium text-accent hover:underline">
                Public agenda
              </Link>
              <Link to={`/embed/v1/${event.slug}/sessions`} className="font-medium text-accent hover:underline">
                Public sessions
              </Link>
              <Link to={`/embed/v1/${event.slug}/speakers`} className="font-medium text-accent hover:underline">
                Public speakers
              </Link>
            </>
          ) : null}
          <Link to="/docs/api" className="text-slate-500 hover:text-slate-900">
            API docs
          </Link>
        </nav>
      </main>
    </>
  );
}
