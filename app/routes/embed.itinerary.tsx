// Schedule itinerary widget: every published session in day order, grouped under
// time headers, with the full card anatomy. Each card can be added to a personal
// schedule, which is kept in a cookie so it survives a reload without an account,
// and the selection exports as an .ics file.

import { data, redirect } from "react-router";
import type { Route } from "./+types/embed.itinerary";
import { filterSessions, groupByDay, loadPublicData, readFilters } from "../lib/public.server";
import { readBranding } from "../lib/embed-view";
import { itinerarySetCookie, readItinerary } from "../lib/itinerary.server";
import {
  EmbedSearch,
  EmbedShell,
  EmptyPublic,
  ShowMore,
  SpeakerLine,
  SessionTags,
  embedButtonSecondary,
} from "../components/embed";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Itinerary" }];
  return [
    { title: `Itinerary | ${loaderData.event.name}` },
    {
      name: "description",
      content: `Build a personal schedule for ${loaderData.event.name} and export it to your calendar.`,
    },
  ];
}

export function headers() {
  // This page reflects a per-visitor cookie, so it must never be cached publicly.
  return { "Cache-Control": "private, no-store", Vary: "Cookie" };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const all = await loadPublicData(String(params.eventSlug));
  const filters = readFilters(url);
  const mine = url.searchParams.get("mine") === "1";
  const picked = readItinerary(request, all.event.id);

  let sessions = filterSessions(all.sessions, filters);
  if (mine) sessions = sessions.filter((session) => picked.includes(session.id));

  return data({
    event: all.event,
    branding: readBranding(url.searchParams),
    days: groupByDay(sessions, all.days).map((group) => ({
      ...group,
      slots: [...new Set(group.sessions.map((session) => session.startLabel))].map((label) => ({
        label,
        sessions: group.sessions.filter((session) => session.startLabel === label),
      })),
    })),
    filters,
    mine,
    picked,
    total: all.sessions.length,
    shown: sessions.length,
    tracks: all.tracks,
    formats: all.formats,
    rooms: all.rooms.map((room) => room.name),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const all = await loadPublicData(String(params.eventSlug));
  const form = await request.formData();
  const sessionId = Number(form.get("sessionId") ?? 0);
  const intent = String(form.get("intent") ?? "");
  const returnTo = String(form.get("returnTo") ?? `/embed/v1/${all.event.slug}/itinerary`);

  const current = readItinerary(request, all.event.id);
  const known = all.sessions.some((session) => session.id === sessionId);
  const next =
    intent === "add" && known
      ? [...current, sessionId]
      : intent === "remove"
        ? current.filter((id) => id !== sessionId)
        : current;

  // Only ever bounce back inside this app. "/" alone is not enough: "//attacker.example"
  // is a scheme-relative URL, and browsers normalize backslashes to forward slashes,
  // so "/\\attacker.example" reaches the same place. Resolve against this request's
  // own origin and require the result to still be on it.
  const fallback = `/embed/v1/${all.event.slug}/itinerary`;
  const safeReturn = (() => {
    if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\")) return fallback;
    const origin = new URL(request.url).origin;
    const resolved = new URL(returnTo, origin);
    return resolved.origin === origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : fallback;
  })();
  return redirect(safeReturn, { headers: { "Set-Cookie": itinerarySetCookie(all.event.id, next) } });
}

export default function ItineraryWidget({ loaderData }: Route.ComponentProps) {
  const { event, days, filters, mine, picked, total, shown, tracks, formats, rooms, branding } = loaderData;
  const base = `/embed/v1/${event.slug}/itinerary`;
  const returnTo = `${base}${mine ? "?mine=1" : ""}`;

  return (
    <EmbedShell branding={branding} event={event} current="itinerary" heading={mine ? "My schedule" : "Itinerary"}>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={base}
          aria-current={!mine ? "page" : undefined}
          className={`inline-flex h-11 items-center rounded-md px-3 text-base font-medium ${
            !mine ? "bg-slate-50 text-accent" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          All sessions
        </a>
        <a
          href={`${base}?mine=1`}
          aria-current={mine ? "page" : undefined}
          className={`inline-flex h-11 items-center rounded-md px-3 text-base font-medium ${
            mine ? "bg-slate-50 text-accent" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          My schedule ({picked.length})
        </a>
        {picked.length > 0 ? (
          <a href={`/embed/v1/${event.slug}/itinerary.ics`} className={embedButtonSecondary}>
            Add to calendar
          </a>
        ) : null}
      </div>

      <EmbedSearch
        action={base}
        placeholder="Search by speaker or session title"
        q={filters.q}
        hidden={mine ? { mine: "1" } : {}}
        resultLabel={mine ? `${shown} in your schedule` : `Sessions 1 - ${shown} of ${total}`}
        facets={[
          { name: "track", label: "Track", value: filters.track, options: tracks },
          { name: "format", label: "Format", value: filters.format, options: formats },
          { name: "room", label: "Location", value: filters.room, options: rooms },
        ]}
      />

      {days.length === 0 ? (
        <EmptyPublic
          message={
            mine
              ? "Your schedule is empty. Add sessions from the itinerary."
              : total === 0
                ? "No sessions have been published yet."
                : "No sessions match this search."
          }
        />
      ) : (
        days.map((group) => (
          <section key={group.value} className="mt-8">
            <h3 className="text-base font-semibold text-slate-900">{group.label}</h3>
            {group.slots.map((slot) => (
              <div key={slot.label} className="mt-4">
                <p className="border-b border-slate-200 pb-1 text-[13px] font-medium tracking-wide text-slate-500">{slot.label}</p>
                <ul className="divide-y divide-slate-200">
                  {slot.sessions.map((session) => {
                    const added = picked.includes(session.id);
                    return (
                      <li key={session.id} className="py-5">
                        {session.trackName ? (
                          <p className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
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
                        <h4 className="mt-1 text-base font-semibold text-slate-900">
                          <a href={`/embed/v1/${event.slug}/sessions?session=${session.id}`} className="hover:text-accent">
                            {session.title}
                          </a>
                        </h4>
                        <ShowMore text={session.abstract} />
                        <p className="mt-2 text-base text-slate-500">{session.whenLabel}</p>
                        <p className="text-base text-slate-500">{session.roomName}</p>

                        {session.speakers.length > 0 ? (
                          <ul className="mt-2">
                            {session.speakers.map((speaker) => (
                              <SpeakerLine key={speaker.contactId} speaker={speaker} />
                            ))}
                          </ul>
                        ) : null}

                        <SessionTags session={session} />

                        <form method="post" action={base} className="mt-3">
                          <input type="hidden" name="sessionId" value={session.id} />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <button
                            type="submit"
                            name="intent"
                            value={added ? "remove" : "add"}
                            aria-pressed={added}
                            className={`inline-flex h-11 items-center rounded-md border px-4 text-base font-medium ${
                              added ? "border-accent text-accent" : "border-slate-200 text-slate-900 hover:bg-slate-50"
                            }`}
                          >
                            {added ? "In my schedule, remove" : "Add to my schedule"}
                          </button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
    </EmbedShell>
  );
}
