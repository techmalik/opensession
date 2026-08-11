// The public page for one event, /e/:eventSlug. No login. This is what the
// homepage's featured event card and every organizer's "Public page" link point at,
// and it is the only place a specific event has a page of its own: the homepage can
// only ever feature one.

import { and, asc, eq } from "drizzle-orm";
import { data, Link } from "react-router";
import type { Route } from "./+types/event-public";
import { getDb } from "../lib/db.server";
import { events, forms } from "../../database/schema";
import { EventOverview } from "../components/event-public";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData?.event) return [{ title: "Event | OpenSession" }];
  return [
    { title: `${loaderData.event.name} | OpenSession` },
    {
      name: "description",
      content: loaderData.event.tagline || `${loaderData.event.name}, on OpenSession.`,
    },
  ];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ params }: Route.LoaderArgs) {
  const db = getDb();
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
    .where(and(eq(events.slug, params.eventSlug), eq(events.status, "active")))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const openForm = await db
    .select({ name: forms.name, closesAt: forms.closesAt })
    .from(forms)
    .where(and(eq(forms.eventId, event.id), eq(forms.status, "published")))
    .orderBy(asc(forms.closesAt))
    .get();

  return data(
    { event, openForm: openForm ?? null },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}

export default function EventPublic({ loaderData }: Route.ComponentProps) {
  const { event, openForm } = loaderData;

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-16">
      <p className="text-[13px] font-medium tracking-wide text-slate-500">
        <Link to="/" className="hover:text-slate-900">
          OpenSession
        </Link>
      </p>
      <EventOverview event={event} openForm={openForm} />
    </main>
  );
}
