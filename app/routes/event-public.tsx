// The public page for one event, /e/:eventSlug. No login. This is what the
// homepage's featured event card and every organizer's "Public page" link point at,
// and it is the only place a specific event has a page of its own: the homepage can
// only ever feature one.

import { and, asc, eq } from "drizzle-orm";
import { data } from "react-router";
import type { Route } from "./+types/event-public";
import { getDb } from "../lib/db.server";
import { getSessionRole } from "../lib/session.server";
import { events, forms } from "../../database/schema";
import { EventOverview } from "../components/event-public";
import { PublicHeader } from "../components/ui";

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

export async function loader({ request, params }: Route.LoaderArgs) {
  const role = await getSessionRole(request);
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

  // The header changes with the reader once someone is signed in, so a signed-in
  // response must never land in a shared cache. Logged out, which is nearly every
  // visit, the page is still cacheable for five minutes.
  return data(
    { event, openForm: openForm ?? null, role },
    { headers: { "Cache-Control": role ? "private, no-store" : "public, max-age=300" } }
  );
}

export default function EventPublic({ loaderData }: Route.ComponentProps) {
  const { event, openForm, role } = loaderData;

  return (
    <>
      <PublicHeader role={role} />
      <main className="mx-auto w-full max-w-[720px] px-6 py-16">
        <EventOverview event={event} openForm={openForm} />
      </main>
    </>
  );
}
