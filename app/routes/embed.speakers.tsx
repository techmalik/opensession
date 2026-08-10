// Speakers list widget: a directory, alphabetical by surname, pairing each person
// with their sessions. ?speaker=<contactId> opens the profile with a Back control.

import { data } from "react-router";
import type { Route } from "./+types/embed.speakers";
import { filterSpeakers, loadPublicData, publicCacheHeaders } from "../lib/public.server";
import { Avatar, EmbedSearch, EmbedShell, EmptyPublic, ShowMore } from "../components/embed";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `Speakers | ${loaderData.event.name}` : "Speakers" }];
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const all = await loadPublicData(String(params.eventSlug));
  const q = (url.searchParams.get("q") ?? "").trim();
  const detailId = Number(url.searchParams.get("speaker") ?? 0) || null;

  return data(
    {
      event: all.event,
      speakers: filterSpeakers(all.speakers, q),
      total: all.speakers.length,
      q,
      detail: detailId ? (all.speakers.find((speaker) => speaker.contactId === detailId) ?? null) : null,
    },
    { headers: publicCacheHeaders(url) }
  );
}

export default function SpeakersWidget({ loaderData }: Route.ComponentProps) {
  const { event, speakers, total, q, detail } = loaderData;
  const base = `/embed/v1/${event.slug}/speakers`;
  const sessionsBase = `/embed/v1/${event.slug}/sessions`;

  if (detail) {
    return (
      <EmbedShell event={event} current="speakers" heading={detail.name}>
        <div className="mt-3 flex items-start gap-4">
          <Avatar speaker={detail} size={96} />
          <div className="min-w-0">
            {detail.title ? <p className="text-base text-slate-900">{detail.title}</p> : null}
            {detail.company ? <p className="text-base text-slate-500">Company Name: {detail.company}</p> : null}
          </div>
        </div>
        <ShowMore text={detail.bio ?? ""} />

        <section className="mt-6">
          <h3 className="text-base font-semibold text-slate-900">Sessions ({detail.sessions.length})</h3>
          <ul className="mt-2 divide-y divide-slate-200 border-t border-slate-200">
            {detail.sessions.map((session) => (
              <li key={session.id} className="py-3">
                <a href={`${sessionsBase}?session=${session.id}`} className="text-base font-medium text-slate-900 hover:text-accent">
                  {session.title}
                </a>
                <p className="text-base text-slate-500">{session.whenLabel}</p>
                <p className="text-base text-slate-500">{session.roomName}</p>
                <p className="text-[13px] text-slate-500">Roles: speaker</p>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-8">
          <a href={base} className="text-base font-medium text-accent hover:underline">
            Back to all speakers
          </a>
        </p>
      </EmbedShell>
    );
  }

  return (
    <EmbedShell event={event} current="speakers" heading="Speakers">
      <EmbedSearch
        action={base}
        placeholder="Search speakers and sessions"
        q={q}
        resultLabel={speakers.length === total ? `Speakers 1 - ${total} of ${total}` : `Speakers 1 - ${speakers.length} of ${total}`}
      />

      {speakers.length === 0 ? (
        <EmptyPublic message={total === 0 ? "No speakers have been published yet." : "No speakers match that name."} />
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
          {speakers.map((speaker) => (
            <li key={speaker.contactId} className="py-5">
              <div className="flex items-start gap-4">
                <Avatar speaker={speaker} size={64} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-slate-900">
                    <a href={`${base}?speaker=${speaker.contactId}`} className="hover:text-accent">
                      {speaker.name}
                    </a>
                  </h3>
                  {speaker.title ? <p className="text-base text-slate-900">{speaker.title}</p> : null}
                  {speaker.company ? <p className="text-base text-slate-500">{speaker.company}</p> : null}
                  <ShowMore text={speaker.bio ?? ""} chars={140} />
                </div>
              </div>

              <ul className="mt-3 space-y-2 border-l-2 border-slate-100 pl-4">
                {speaker.sessions.map((session) => (
                  <li key={session.id}>
                    <a href={`${sessionsBase}?session=${session.id}`} className="text-base font-medium text-slate-900 hover:text-accent">
                      {session.title}
                    </a>
                    <p className="text-[13px] text-slate-500">
                      {session.whenLabel}, {session.roomName}
                    </p>
                    <p className="text-[13px] text-slate-500">Roles: speaker</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </EmbedShell>
  );
}
