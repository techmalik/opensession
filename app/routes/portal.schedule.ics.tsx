// Resource route: the speaker's own schedule as a calendar file. ?session=<id>
// narrows it to one session. Only the requester's sessions are ever included.

import type { Route } from "./+types/portal.schedule.ics";
import { appBaseUrl } from "../lib/db.server";
import { requireSpeaker, mySessions } from "../lib/portal.server";
import { buildIcsCalendar, icsResponse } from "../lib/ics";

export async function loader({ request }: Route.LoaderArgs) {
  const { contactId } = await requireSpeaker(request);
  const url = new URL(request.url);
  const only = Number(url.searchParams.get("session") ?? 0) || null;

  const sessions = (await mySessions(contactId)).filter(
    (session) =>
      session.startsAt != null &&
      session.endsAt != null &&
      session.statusKey === "accepted" &&
      session.inviteStatus !== "declined" &&
      (only == null || session.id === only)
  );

  if (sessions.length === 0) throw new Response("Nothing scheduled", { status: 404 });

  const body = buildIcsCalendar(
    sessions.map((session) => ({
      uid: `opensession-session-${session.id}@opensession`,
      title: session.title,
      location: [session.roomName, session.eventLocation].filter(Boolean).join(", ") || null,
      description: `${session.eventName} session ${session.friendlyId}`,
      start: session.startsAt as Date,
      end: session.endsAt as Date,
      url: `${appBaseUrl()}/portal/submissions/${session.id}`,
    })),
    {
      method: "REQUEST",
      timezone: sessions[0].eventTimezone,
      name: `${sessions[0].eventName} schedule`,
    }
  );

  return icsResponse(only ? `session-${only}.ics` : "my-schedule.ics", body);
}
