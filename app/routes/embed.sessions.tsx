// Sessions list widget: the session catalog. Keyword search matches session titles,
// abstracts, and speaker names; the Filters panel facets on track, format, and room.
// ?session=<id> opens the detail view with a Back control.

import { data } from "react-router";
import type { Route } from "./+types/embed.sessions";
import {
  filterSessions,
  loadPublicData,
  publicCacheHeaders,
  readFilters,
} from "../lib/public.server";
import { EmbedSearch, EmbedShell, EmptyPublic, ShowMore, SpeakerLine, SessionTags } from "../components/embed";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `Sessions | ${loaderData.event.name}` : "Sessions" }];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const all = await loadPublicData(String(params.eventSlug));
  const filters = readFilters(url);
  const sessions = filterSessions(all.sessions, filters);
  const detailId = Number(url.searchParams.get("session") ?? 0) || null;

  return data(
    {
      event: all.event,
      sessions,
      total: all.sessions.length,
      filters,
      tracks: all.tracks,
      formats: all.formats,
      rooms: all.rooms.map((room) => room.name),
      detail: detailId ? (all.sessions.find((session) => session.id === detailId) ?? null) : null,
      query: url.search,
    },
    { headers: publicCacheHeaders(url) }
  );
}

export default function SessionsWidget({ loaderData }: Route.ComponentProps) {
  const { event, sessions, total, filters, tracks, formats, rooms, detail } = loaderData;
  const base = `/embed/v1/${event.slug}/sessions`;

  if (detail) {
    return (
      <EmbedShell event={event} current="sessions" heading={detail.title}>
        <p className="mt-1 text-base text-slate-500">{detail.whenLabel}</p>
        <p className="text-base text-slate-500">{detail.roomName}</p>
        <SessionTags session={detail} />
        <ShowMore text={detail.abstract} chars={100000} />

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
          <a href={base} className="text-base font-medium text-accent hover:underline">
            Back to all sessions
          </a>
        </p>
      </EmbedShell>
    );
  }

  return (
    <EmbedShell event={event} current="sessions" heading="Sessions">
      <EmbedSearch
        action={base}
        placeholder="Search by speaker or session title"
        q={filters.q}
        resultLabel={sessions.length === total ? `Sessions 1 - ${total} of ${total}` : `Sessions 1 - ${sessions.length} of ${total}`}
        facets={[
          { name: "track", label: "Track", value: filters.track, options: tracks },
          { name: "format", label: "Format", value: filters.format, options: formats },
          { name: "room", label: "Location", value: filters.room, options: rooms },
        ]}
      />

      {sessions.length === 0 ? (
        <EmptyPublic
          message={total === 0 ? "No sessions have been published yet." : "No sessions match this search. Clear the filters to see all sessions."}
        />
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
          {sessions.map((session) => (
            <li key={session.id} className="py-5">
              <h3 className="text-base font-semibold text-slate-900">
                <a href={`${base}?session=${session.id}`} className="hover:text-accent">
                  {session.title}
                </a>
              </h3>
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
              <p className="mt-2">
                <a href={`${base}?session=${session.id}`} className="text-base font-medium text-accent hover:underline">
                  View details
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}
    </EmbedShell>
  );
}
