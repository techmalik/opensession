// The public schedule. Server-rendered, logged out, readable at 375px. Visible only
// once an organizer publishes the agenda. The full embed suite lands in Phase 5; this
// is the page the publish action points at.

import { eq } from "drizzle-orm";
import type { Route } from "./+types/agenda.public";
import { getDb } from "../lib/db.server";
import { loadAgenda } from "../lib/agenda.server";
import { formatDayLabel, formatTimeOfDay, toZonedDateValue } from "../lib/format";
import { events } from "../../database/schema";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.event ? `Agenda | ${loaderData.event.name}` : "Agenda" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const db = getDb();
  const event = await db
    .select({ id: events.id, status: events.status, agendaPublishedAt: events.agendaPublishedAt })
    .from(events)
    .where(eq(events.slug, String(params.eventSlug)))
    .get();
  if (!event || event.status !== "active") throw new Response("Not found", { status: 404 });
  if (!event.agendaPublishedAt) {
    throw new Response("This agenda is not published yet.", { status: 404 });
  }

  const data = await loadAgenda(event.id);
  const byDay = data.days
    .map((day) => ({
      day,
      label: formatDayLabel(day, data.event.timezone),
      sessions: data.scheduled
        .filter((session) => session.startsAt && toZonedDateValue(session.startsAt, data.event.timezone) === day)
        .sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0))
        .map((session) => ({
          id: session.id,
          title: session.title,
          roomName: session.roomName,
          trackName: session.trackName,
          trackColor: session.trackColor,
          speakers: session.speakers.map((speaker) => speaker.name),
          start: formatTimeOfDay(session.startsAt, data.event.timezone),
          end: formatTimeOfDay(session.endsAt, data.event.timezone),
        })),
    }))
    .filter((group) => group.sessions.length > 0);

  return { event: data.event, days: byDay };
}

export default function PublicAgenda({ loaderData }: Route.ComponentProps) {
  const { event, days } = loaderData;

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto w-full max-w-[720px] px-6 py-10">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{event.name}</h1>
        <p className="mt-1 text-base text-slate-500">
          Agenda{event.location ? `, ${event.location}` : ""}
        </p>

        {days.length === 0 ? (
          <p className="mt-8 text-base text-slate-500">No sessions are scheduled yet.</p>
        ) : (
          days.map((group) => (
            <section key={group.day} className="mt-8">
              <h2 className="text-base font-semibold text-slate-900">{group.label}</h2>
              <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
                {group.sessions.map((session) => (
                  <li key={session.id} className="py-4">
                    <p className="text-base font-medium text-slate-900">{session.title}</p>
                    <p className="mt-1 text-base text-slate-500">
                      {session.start} to {session.end}
                      {session.roomName ? `, ${session.roomName}` : ""}
                    </p>
                    {session.speakers.length > 0 ? (
                      <p className="mt-1 text-base text-slate-500">{session.speakers.join(", ")}</p>
                    ) : null}
                    {session.trackName ? (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                        {session.trackColor ? (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: session.trackColor }}
                            aria-hidden="true"
                          />
                        ) : null}
                        {session.trackName}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
