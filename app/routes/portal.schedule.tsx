// The speaker's own schedule: accepted sessions with their day, time, and room, and
// a calendar file they can add to whatever they use.

import { Link } from "react-router";
import type { Route } from "./+types/portal.schedule";
import { requireSpeaker, mySessions } from "../lib/portal.server";
import { formatDate, formatTimeOfDay } from "../lib/format";
import { ROLE_LABEL } from "../lib/labels";
import { AppBar, Card, EmptyState, PortalNav, buttonPrimary, buttonSecondary } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "My schedule | Your portal" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, contactId } = await requireSpeaker(request);
  const all = await mySessions(contactId);
  const accepted = all.filter((session) => session.statusKey === "accepted" && session.inviteStatus !== "declined");
  return {
    user,
    sessions: accepted,
    scheduledCount: accepted.filter((session) => session.startsAt != null).length,
  };
}

export default function PortalSchedule({ loaderData }: Route.ComponentProps) {
  const { user, sessions, scheduledCount } = loaderData;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="OpenSession" userName={user.name} homeTo="/portal" />

      <main className="mx-auto w-full max-w-[960px] px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">My schedule</h1>
        <p className="mt-1 text-sm text-slate-500">Your accepted sessions and where they land in the program.</p>

        <div className="mt-5">
          <PortalNav current="/portal/schedule" />
        </div>

        {scheduledCount > 0 ? (
          <a href="/portal/schedule.ics" className={`${buttonPrimary} mb-4`}>
            Add all to calendar
          </a>
        ) : null}

        {sessions.length === 0 ? (
          <Card>
            <EmptyState
              message="Nothing accepted yet. Accepted sessions appear here with their room and time."
              action={
                <Link to="/portal" className={buttonSecondary}>
                  Back to overview
                </Link>
              }
            />
          </Card>
        ) : (
          <ul className="space-y-3">
            {sessions.map((session) => (
              <li key={session.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        to={`/portal/submissions/${session.id}`}
                        className="text-sm font-medium text-slate-900 hover:text-accent"
                      >
                        {session.title}
                      </Link>
                      <p className="mt-0.5 text-[13px] text-slate-500">
                        {session.eventName}, as {ROLE_LABEL[session.role] ?? session.role}
                        {session.trackName ? `, ${session.trackName}` : ""}
                      </p>
                      <p className="mt-1 text-sm text-slate-900">
                        {session.startsAt ? (
                          <>
                            {formatDate(session.startsAt, session.eventTimezone)},{" "}
                            {formatTimeOfDay(session.startsAt, session.eventTimezone)} to{" "}
                            {formatTimeOfDay(session.endsAt, session.eventTimezone)}
                            {session.roomName ? `, ${session.roomName}` : ""}
                          </>
                        ) : (
                          <span className="text-slate-500">Not scheduled yet</span>
                        )}
                      </p>
                      {session.eventLocation ? (
                        <p className="text-[13px] text-slate-500">{session.eventLocation}</p>
                      ) : null}
                    </div>
                    {session.startsAt ? (
                      <a href={`/portal/schedule.ics?session=${session.id}`} className={buttonSecondary}>
                        Add to calendar
                      </a>
                    ) : null}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
