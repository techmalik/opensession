// Speaker gallery widget: a photo grid, alphabetical by surname, with name search.
// A speaker with no headshot renders an initials tile rather than a hole in the grid.
// ?speaker=<contactId> opens the detail panel with a Back control.

import { data } from "react-router";
import type { Route } from "./+types/embed.gallery";
import { filterSpeakers, loadPublicData, publicCacheHeaders } from "../lib/public.server";
import { Avatar, EmbedSearch, EmbedShell, EmptyPublic, ShowMore, embedLink } from "../components/embed";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Speaker gallery" }];
  return [
    { title: `Speaker gallery | ${loaderData.event.name}` },
    { name: "description", content: `Headshots and bios for the speakers at ${loaderData.event.name}.` },
  ];
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

export default function GalleryWidget({ loaderData }: Route.ComponentProps) {
  const { event, speakers, total, q, detail } = loaderData;
  const base = `/embed/v1/${event.slug}/gallery`;

  if (detail) {
    return (
      <EmbedShell event={event} current="gallery" heading={detail.name}>
        <p className="mt-2">
          <a href={base} className={embedLink}>
            Back to the gallery
          </a>
        </p>
        <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row">
          <Avatar speaker={detail} size={160} />
          <div className="min-w-0">
            {detail.title ? <p className="text-base text-slate-900">{detail.title}</p> : null}
            {detail.company ? <p className="text-base text-slate-500">Company Name: {detail.company}</p> : null}
            <ShowMore text={detail.bio ?? ""} />
          </div>
        </div>

        <section className="mt-6">
          <h3 className="text-base font-semibold text-slate-900">Sessions ({detail.sessions.length})</h3>
          <ul className="mt-2 divide-y divide-slate-200 border-t border-slate-200">
            {detail.sessions.map((session) => (
              <li key={session.id} className="py-3">
                <a
                  href={`/embed/v1/${event.slug}/sessions?session=${session.id}`}
                  className="text-base font-medium text-slate-900 hover:text-accent"
                >
                  {session.title}
                </a>
                <p className="text-base text-slate-500">{session.whenLabel}</p>
                <p className="text-base text-slate-500">{session.roomName}</p>
              </li>
            ))}
          </ul>
        </section>
      </EmbedShell>
    );
  }

  return (
    <EmbedShell event={event} current="gallery" heading="Speakers">
      <EmbedSearch
        action={base}
        placeholder="Search speaker by name"
        q={q}
        resultLabel={speakers.length === total ? `${total} ${total === 1 ? "speaker" : "speakers"}` : `${speakers.length} of ${total} speakers`}
      />

      {speakers.length === 0 ? (
        <EmptyPublic message={total === 0 ? "No speakers have been published yet." : "No speakers match that name."} />
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
          {speakers.map((speaker) => (
            <li key={speaker.contactId} className="rounded-lg border border-slate-200 p-3">
              <a href={`${base}?speaker=${speaker.contactId}`} className="block">
                <span className="flex justify-center">
                  <Avatar speaker={speaker} size={120} />
                </span>
                <span className="mt-3 block text-center text-base font-semibold text-slate-900">{speaker.name}</span>
                <span className="mt-0.5 block text-center text-[13px] text-slate-500">
                  {speaker.title || "Speaker"}
                </span>
                <span className="block text-center text-[13px] text-slate-500">{speaker.company ?? ""}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </EmbedShell>
  );
}
