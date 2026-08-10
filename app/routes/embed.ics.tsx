// Calendar feed: every published, scheduled session as one VCALENDAR. Subscribing
// to this URL in Google Calendar or Apple Calendar gives a live program.

import type { Route } from "./+types/embed.ics";
import { appBaseUrl } from "../lib/db.server";
import { loadPublicData, publicCacheHeaders } from "../lib/public.server";
import { buildIcsCalendar } from "../lib/ics";

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const all = await loadPublicData(String(params.eventSlug));

  const body = buildIcsCalendar(
    all.sessions.map((session) => ({
      uid: `opensession-session-${session.id}@opensession`,
      title: session.title,
      description: [session.abstract, session.speakers.map((speaker) => speaker.name).join(", ")]
        .filter(Boolean)
        .join("\n\n"),
      location: [session.roomName, all.event.location].filter(Boolean).join(", ") || null,
      start: new Date(session.startIso),
      end: new Date(session.endIso),
      url: `${appBaseUrl()}/embed/v1/${all.event.slug}/sessions?session=${session.id}`,
    })),
    { method: "PUBLISH", timezone: all.event.timezone, name: all.event.name }
  );

  return new Response(body, {
    headers: publicCacheHeaders(url, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${all.event.slug}.ics"`,
      "Access-Control-Allow-Origin": "*",
    }),
  });
}
