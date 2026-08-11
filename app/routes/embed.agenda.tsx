// Agenda widget: one day at a time, rooms as columns and time as rows. Day
// navigation is plain links. Below 768px the grid is replaced by a time-ordered
// list of the same day, which is what a phone can actually read.
// ?session=<id> opens the block detail with a Back control.

import { data } from "react-router";
import type { Route } from "./+types/embed.agenda";
import { loadPublicData, publicCacheHeaders } from "../lib/public.server";
import { EmbedShell, EmptyPublic, SessionTags, ShowMore, SpeakerLine, embedLink } from "../components/embed";

const ROW_PX = 26; // one 15-minute row
const MIN_BLOCK_ROWS = 2; // a 10-minute talk still needs room for its title
const SLOT = 15;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Agenda" }];
  return [
    { title: `Agenda | ${loaderData.event.name}` },
    { name: "description", content: `The full schedule for ${loaderData.event.name}, by day and room.` },
  ];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

function timeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const all = await loadPublicData(String(params.eventSlug));
  const detailId = Number(url.searchParams.get("session") ?? 0) || null;

  const days = all.days.filter((day) => all.sessions.some((session) => session.day === day.value));
  const requested = url.searchParams.get("day") ?? "";
  const day = days.find((row) => row.value === requested)?.value ?? days[0]?.value ?? "";
  const index = days.findIndex((row) => row.value === day);
  const sessions = all.sessions
    .filter((session) => session.day === day)
    .sort((a, b) => a.startMinutes - b.startMinutes || (a.roomName ?? "").localeCompare(b.roomName ?? ""));

  // Window the grid to the day's real span, rounded out to the hour.
  const starts = sessions.map((session) => session.startMinutes);
  const ends = sessions.map((session) => session.startMinutes + session.durationMin);
  const from = starts.length > 0 ? Math.floor(Math.min(...starts) / 60) * 60 : 8 * 60;
  const to = ends.length > 0 ? Math.ceil(Math.max(...ends) / 60) * 60 : 18 * 60;

  return data(
    {
      event: all.event,
      days,
      day,
      dayLabel: days[index]?.label ?? "",
      prevDay: index > 0 ? days[index - 1] : null,
      nextDay: index >= 0 && index < days.length - 1 ? days[index + 1] : null,
      rooms: all.rooms.filter((room) => sessions.some((session) => session.roomId === room.id)),
      sessions,
      gridRows: Array.from({ length: Math.max(1, (to - from) / SLOT) }, (_, i) => from + i * SLOT).map((minutes) => ({
        minutes,
        label: minutes % 60 === 0 ? timeLabel(minutes) : "",
      })),
      gridFrom: from,
      detail: detailId ? (all.sessions.find((session) => session.id === detailId) ?? null) : null,
    },
    { headers: publicCacheHeaders(url) }
  );
}

export default function AgendaWidget({ loaderData }: Route.ComponentProps) {
  const { event, days, day, dayLabel, prevDay, nextDay, rooms, sessions, gridRows, gridFrom, detail } = loaderData;
  const base = `/embed/v1/${event.slug}/agenda`;

  if (detail) {
    return (
      <EmbedShell event={event} current="agenda" heading={detail.title} wide>
        <p className="mt-1 text-base text-slate-500">{detail.whenLabel}</p>
        <p className="text-base text-slate-500">{detail.roomName}</p>
        <SessionTags session={detail} />
        <ShowMore text={detail.abstract} />

        {detail.speakers.length > 0 ? (
          <section className="mt-6">
            <h3 className="text-base font-semibold text-slate-900">Speakers ({detail.speakers.length})</h3>
            <ul className="mt-2 divide-y divide-slate-100">
              {detail.speakers.map((speaker) => (
                <SpeakerLine key={speaker.contactId} speaker={speaker} />
              ))}
            </ul>
          </section>
        ) : null}

        <p className="mt-8">
          <a href={`${base}?day=${detail.day}`} className={embedLink}>
            Back to the agenda
          </a>
        </p>
      </EmbedShell>
    );
  }

  return (
    <EmbedShell event={event} current="agenda" heading="Agenda" wide>
      {days.length === 0 ? (
        <EmptyPublic message="No sessions have been scheduled yet." />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              href={prevDay ? `${base}?day=${prevDay.value}` : base}
              aria-disabled={!prevDay}
              className={`inline-flex h-11 items-center rounded-md border border-slate-200 px-3 text-base font-medium ${
                prevDay ? "text-slate-900 hover:bg-slate-50" : "pointer-events-none text-slate-300"
              }`}
            >
              Previous day
            </a>
            <p className="text-base font-semibold text-slate-900">{dayLabel}</p>
            <a
              href={nextDay ? `${base}?day=${nextDay.value}` : base}
              aria-disabled={!nextDay}
              className={`inline-flex h-11 items-center rounded-md border border-slate-200 px-3 text-base font-medium ${
                nextDay ? "text-slate-900 hover:bg-slate-50" : "pointer-events-none text-slate-300"
              }`}
            >
              Next day
            </a>
          </div>

          <nav aria-label="Days" className="mt-2 flex flex-wrap gap-1">
            {days.map((row) => (
              <a
                key={row.value}
                href={`${base}?day=${row.value}`}
                aria-current={row.value === day ? "page" : undefined}
                className={`inline-flex h-11 items-center rounded-md px-3 text-base font-medium ${
                  row.value === day ? "bg-slate-50 text-accent" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {row.label}
              </a>
            ))}
          </nav>

          {/* Grid: rooms as columns. Scrolls horizontally rather than squeezing. */}
          <div className="mt-4 hidden overflow-x-auto border-t border-slate-200 md:block">
            <div className="flex min-w-max">
              <div className="w-20 shrink-0 border-r border-slate-200">
                <div className="h-10 border-b border-slate-200" />
                {gridRows.map((row) => (
                  <div key={row.minutes} className="border-b border-slate-100 pr-2 text-right" style={{ height: ROW_PX }}>
                    {row.label ? <span className="text-[13px] leading-6 text-slate-500">{row.label}</span> : null}
                  </div>
                ))}
              </div>

              {rooms.map((room) => (
                <div key={room.id} className="w-[220px] shrink-0 border-r border-slate-200 last:border-r-0">
                  <div className="flex h-10 items-center border-b border-slate-200 px-2">
                    <span className="truncate text-base font-medium text-slate-900">{room.name}</span>
                  </div>
                  <div className="relative">
                    {gridRows.map((row) => (
                      <div key={row.minutes} className="border-b border-slate-100" style={{ height: ROW_PX }} />
                    ))}
                    {sessions
                      .filter((session) => session.roomId === room.id)
                      .map((session) => (
                        <a
                          key={session.id}
                          href={`${base}?session=${session.id}`}
                          className="absolute left-1 right-1 overflow-hidden rounded-md border border-slate-200 bg-white px-2 py-1 hover:border-accent"
                          style={{
                            top: ((session.startMinutes - gridFrom) / SLOT) * ROW_PX,
                            height: Math.max(MIN_BLOCK_ROWS * ROW_PX, (session.durationMin / SLOT) * ROW_PX) - 2,
                          }}
                        >
                          {session.trackName ? (
                            <span className="flex items-center gap-1.5 text-[11px] leading-4 text-slate-500">
                              {session.trackColor ? (
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: session.trackColor }}
                                  aria-hidden="true"
                                />
                              ) : null}
                              {session.trackName}
                            </span>
                          ) : null}
                          <span className="block text-[13px] font-medium leading-tight text-slate-900">{session.title}</span>
                          <span className="block truncate text-[11px] leading-4 text-slate-500">
                            {session.startLabel} to {session.endLabel}, {session.roomName}
                          </span>
                        </a>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Phone layout: the same day as a time-ordered list. */}
          <ul className="mt-4 divide-y divide-slate-200 border-t border-slate-200 md:hidden">
            {sessions.map((session) => (
              <li key={session.id} className="py-4">
                <p className="text-base text-slate-500">
                  {session.startLabel} to {session.endLabel}, {session.roomName}
                </p>
                <a href={`${base}?session=${session.id}`} className="text-base font-semibold text-slate-900 hover:text-accent">
                  {session.title}
                </a>
                <SessionTags session={session} />
              </li>
            ))}
          </ul>

          {sessions.length === 0 ? <EmptyPublic message="Nothing is scheduled on this day." /> : null}
        </>
      )}
    </EmbedShell>
  );
}
