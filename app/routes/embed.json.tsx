// JSON variant of each widget: the same path with a .json suffix. One resource route
// registered five times; the widget is the last path segment minus the suffix.
// Same gate as the HTML widgets, so a held session is absent here too.

import type { Route } from "./+types/embed.json";
import { filterSessions, filterSpeakers, groupByDay, loadPublicData, publicCacheHeaders, readFilters } from "../lib/public.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const widget = (url.pathname.split("/").pop() ?? "").replace(/\.json$/, "");
  const all = await loadPublicData(String(params.eventSlug));
  const filters = readFilters(url);
  const sessions = filterSessions(all.sessions, filters);
  const speakers = filterSpeakers(all.speakers, filters.q);

  const event = {
    name: all.event.name,
    slug: all.event.slug,
    tagline: all.event.tagline,
    location: all.event.location,
    timezone: all.event.timezone,
    dates: all.event.dateRange,
  };

  const asSession = (session: (typeof all.sessions)[number]) => ({
    id: session.id,
    code: session.friendlyId,
    title: session.title,
    abstract: session.abstract,
    track: session.trackName,
    format: session.formatName,
    room: session.roomName,
    day: session.day,
    startsAt: session.startIso,
    endsAt: session.endIso,
    when: session.whenLabel,
    tags: session.tags,
    speakers: session.speakers.map((speaker) => ({
      id: speaker.contactId,
      name: speaker.name,
      title: speaker.title,
      company: speaker.company,
      role: speaker.role,
    })),
  });

  const asSpeaker = (speaker: (typeof all.speakers)[number]) => ({
    id: speaker.contactId,
    name: speaker.name,
    title: speaker.title,
    company: speaker.company,
    bio: speaker.bio,
    headshotUrl: speaker.headshotUrl,
    sessions: speaker.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      when: session.whenLabel,
      room: session.roomName,
    })),
  });

  let body: Record<string, unknown>;
  switch (widget) {
    case "speakers":
    case "gallery":
      body = { widget, event, count: speakers.length, speakers: speakers.map(asSpeaker) };
      break;
    case "agenda":
    case "itinerary":
      body = {
        widget,
        event,
        count: sessions.length,
        days: groupByDay(sessions, all.days).map((group) => ({
          day: group.value,
          label: group.label,
          sessions: group.sessions.map(asSession),
        })),
      };
      break;
    default:
      body = { widget: "sessions", event, count: sessions.length, sessions: sessions.map(asSession) };
  }

  return new Response(JSON.stringify(body, null, 2), {
    headers: publicCacheHeaders(url, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    }),
  });
}
