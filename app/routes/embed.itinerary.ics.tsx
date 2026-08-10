// The visitor's own picks as a calendar file. Reads the same cookie the itinerary
// widget writes, so "Add to calendar" needs no account.

import type { Route } from "./+types/embed.itinerary.ics";
import { appBaseUrl } from "../lib/db.server";
import { loadPublicData } from "../lib/public.server";
import { readItinerary } from "../lib/itinerary.server";
import { buildIcsCalendar, icsResponse } from "../lib/ics";

export async function loader({ request, params }: Route.LoaderArgs) {
  const all = await loadPublicData(String(params.eventSlug));
  const picked = readItinerary(request, all.event.id);
  const chosen = all.sessions.filter((session) => picked.includes(session.id));

  const body = buildIcsCalendar(
    chosen.map((session) => ({
      uid: `opensession-session-${session.id}@opensession`,
      title: session.title,
      description: session.speakers.map((speaker) => speaker.name).join(", ") || null,
      location: [session.roomName, all.event.location].filter(Boolean).join(", ") || null,
      start: new Date(session.startIso),
      end: new Date(session.endIso),
      url: `${appBaseUrl()}/embed/v1/${all.event.slug}/sessions?session=${session.id}`,
    })),
    { method: "PUBLISH", timezone: all.event.timezone, name: `${all.event.name}, my schedule` }
  );

  return icsResponse(`${all.event.slug}-my-schedule.ics`, body);
}
