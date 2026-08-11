// The public schedule at /agenda/:eventSlug. Server-rendered, logged out, readable
// at 375px, and reading the same gate as the embed widgets: accepted, scheduled,
// non-draft, public_state "published".
//
// This page renders for any live event whether or not the agenda has been published.
// Publishing is a signal to the organizer, not a 404 for visitors: a public URL that
// returns "not found" while an event exists is worse than one that says the schedule
// is still being finalised.

import { data } from "react-router";
import type { Route } from "./+types/agenda.public";
import { groupByDay, loadPublicData, publicCacheHeaders } from "../lib/public.server";
import { EmbedShell, EmptyPublic, SessionTags } from "../components/embed";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData?.event) return [{ title: "Agenda" }];
  return [
    { title: `Agenda | ${loaderData.event.name}` },
    { name: "description", content: `The published schedule for ${loaderData.event.name}.` },
  ];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const all = await loadPublicData(String(params.eventSlug));
  return data(
    {
      event: all.event,
      days: groupByDay(all.sessions, all.days),
    },
    { headers: publicCacheHeaders(url) }
  );
}

export default function PublicAgenda({ loaderData }: Route.ComponentProps) {
  const { event, days } = loaderData;

  return (
    <EmbedShell event={event} current="agenda" heading="Agenda">
      {days.length === 0 ? (
        <EmptyPublic message="No sessions are scheduled yet. The programme goes live here once it is set." />
      ) : (
        days.map((group) => (
          <section key={group.value} className="mt-8">
            <h3 className="text-base font-semibold text-slate-900">{group.label}</h3>
            <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
              {group.sessions.map((session) => (
                <li key={session.id} className="py-4">
                  <a
                    href={`/embed/v1/${event.slug}/sessions?session=${session.id}`}
                    className="text-base font-medium text-slate-900 hover:text-accent"
                  >
                    {session.title}
                  </a>
                  <p className="mt-1 text-base text-slate-500">
                    {session.startLabel} to {session.endLabel}
                    {session.roomName ? `, ${session.roomName}` : ""}
                  </p>
                  {session.speakers.length > 0 ? (
                    <p className="mt-1 text-base text-slate-500">
                      {session.speakers.map((speaker) => speaker.name).join(", ")}
                    </p>
                  ) : null}
                  <SessionTags session={session} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </EmbedShell>
  );
}
