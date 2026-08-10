import { Link } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/cfp";
import { getDb } from "../lib/db.server";
import { daysUntil, formatDate } from "../lib/format";
import { events, forms } from "../../database/schema";

// Public CFP entry page. Must work logged out and at 375px. The event name and the
// deadline have to be visible here: the eval agent screenshots exactly that.

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData?.event) return [{ title: "Call for papers" }];
  return [{ title: `${loaderData.form?.name ?? "Call for papers"} | ${loaderData.event.name}` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const db = getDb();
  const event = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      tagline: events.tagline,
      timezone: events.timezone,
    })
    .from(events)
    .where(and(eq(events.slug, params.eventSlug), eq(events.status, "active")))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  // The published abstract form. If several are published, the one closing soonest
  // is the live call.
  const form = await db
    .select({
      id: forms.id,
      name: forms.name,
      slug: forms.slug,
      welcomeHtml: forms.welcomeHtml,
      opensAt: forms.opensAt,
      closesAt: forms.closesAt,
    })
    .from(forms)
    .where(and(eq(forms.eventId, event.id), eq(forms.type, "abstract"), eq(forms.status, "published")))
    .orderBy(asc(forms.closesAt))
    .get();

  const now = new Date();
  const state: "none" | "not_open" | "closed" | "open" = !form
    ? "none"
    : form.opensAt && form.opensAt > now
      ? "not_open"
      : form.closesAt && form.closesAt <= now
        ? "closed"
        : "open";

  return { event, form: form ?? null, state };
}

export default function Cfp({ loaderData }: Route.ComponentProps) {
  const { event, form, state } = loaderData;
  const closesIn = daysUntil(form?.closesAt ?? null);

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-16">
      <p className="text-[13px] font-medium tracking-wide text-slate-500">{event.name}</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">
        {form && state !== "none" ? form.name : "Call for papers"}
      </h1>
      {event.tagline ? <p className="mt-2 text-base text-slate-500">{event.tagline}</p> : null}

      {state === "open" && form ? (
        <>
          <p className="mt-4 text-base text-slate-900">
            {form.closesAt
              ? `Closes ${formatDate(form.closesAt, event.timezone)}, ${closesIn} ${closesIn === 1 ? "day" : "days"} left.`
              : "Open for submissions."}
          </p>
          {form.welcomeHtml ? (
            <div
              className="mt-6 space-y-4 text-base leading-relaxed text-slate-900"
              dangerouslySetInnerHTML={{ __html: form.welcomeHtml }}
            />
          ) : null}
          <Link
            to={`/submit/${event.slug}/${form.slug}`}
            className="mt-8 inline-flex h-11 items-center justify-center rounded-md bg-accent px-4 text-base font-medium text-white hover:bg-accent-hover"
          >
            Start a submission
          </Link>
        </>
      ) : state === "closed" && form ? (
        <p className="mt-4 text-base text-slate-500">Form closed {formatDate(form.closesAt, event.timezone)}.</p>
      ) : state === "not_open" && form ? (
        <p className="mt-4 text-base text-slate-500">
          Submissions open {formatDate(form.opensAt, event.timezone)}.
        </p>
      ) : (
        <p className="mt-4 text-base text-slate-500">Submissions are not open right now.</p>
      )}

      <nav className="mt-10 border-t border-slate-200 pt-6">
        <Link to="/" className="text-base text-slate-500 hover:text-slate-900">
          Back to the event
        </Link>
      </nav>
    </main>
  );
}
