// Embeds: the organizer's view of the five public widgets. Pick a widget, pick the
// filters, copy the snippet. Every URL carries the embed cache version, so the
// "Refresh embeds" button changes every snippet and pushes fresh data everywhere.

import { Form, Link, useSearchParams } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.embeds";
import { appBaseUrl, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { bumpEmbedCacheVersion, embedCacheVersion } from "../lib/settings.server";
import { WIDGETS, type WidgetKind } from "../lib/embed-view";
import { events, formats, sessions, tracks } from "../../database/schema";
import { Card, Notice, PageHeader, buttonPrimary, buttonSecondary, inputClass, selectClass, textareaClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Embeds" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, slug: events.slug })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const widget = (WIDGETS.find((row) => row.kind === url.searchParams.get("widget"))?.kind ?? "sessions") as WidgetKind;
  const track = url.searchParams.get("track") ?? "";
  const format = url.searchParams.get("format") ?? "";
  const height = url.searchParams.get("height") ?? "720";

  const trackRows = await db.select({ name: tracks.name }).from(tracks).where(eq(tracks.eventId, eventId)).all();
  const formatRows = await db.select({ name: formats.name }).from(formats).where(eq(formats.eventId, eventId)).all();
  const publicRows = await db
    .select({ id: sessions.id, publicState: sessions.publicState, startsAt: sessions.startsAt })
    .from(sessions)
    .where(eq(sessions.eventId, eventId))
    .all();

  const version = await embedCacheVersion();
  const query = new URLSearchParams();
  if (track) query.set("track", track);
  if (format) query.set("format", format);
  query.set("v", String(version));

  const base = `${appBaseUrl()}/embed/v1/${event.slug}`;
  const widgetUrl = `${base}/${widget}?${query.toString()}`;

  return {
    event,
    widget,
    widgets: WIDGETS,
    tracks: trackRows.map((row) => row.name),
    formats: formatRows.map((row) => row.name),
    filters: { track, format, height },
    version,
    urls: {
      widget: widgetUrl,
      preview: `/embed/v1/${event.slug}/${widget}?${query.toString()}`,
      json: `${base}/${widget}.json?${query.toString()}`,
      ics: `${base}/calendar.ics`,
      script: `${base}/embed.js`,
    },
    snippets: {
      script:
        `<script src="${base}/embed.js" data-widget="${widget}"` +
        (track ? ` data-track="${track}"` : "") +
        (format ? ` data-format="${format}"` : "") +
        ` data-height="${height}" data-v="${version}"></script>`,
      iframe: `<iframe src="${widgetUrl}" title="${event.name} ${widget}" width="100%" height="${height}" style="border:0" loading="lazy"></iframe>`,
    },
    counts: {
      held: publicRows.filter((row) => row.publicState === "held").length,
      scheduled: publicRows.filter((row) => row.startsAt != null).length,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireOrganizer(request);
  const form = await request.formData();
  if (String(form.get("intent")) !== "refresh") return { notice: null };
  const version = await bumpEmbedCacheVersion();
  return { notice: `Embeds refreshed. Snippet URLs now carry v=${version}, so caches miss and reload the current data.` };
}

export default function Embeds({ loaderData, actionData }: Route.ComponentProps) {
  const { event, widget, widgets, tracks: trackNames, formats: formatNames, filters, version, urls, snippets, counts } =
    loaderData;
  const [searchParams] = useSearchParams();

  const widgetHref = (kind: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("widget", kind);
    return `?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Embeds"
        description={`Public widgets for ${event.name}. Cache version ${version}.`}
        actions={
          <Form method="post">
            <button type="submit" name="intent" value="refresh" className={buttonPrimary}>
              Refresh embeds
            </button>
          </Form>
        }
      />

      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}
      <Notice>
        Widgets show accepted, scheduled sessions that are published to public. {counts.scheduled} scheduled,{" "}
        {counts.held} held from public.
      </Notice>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Widget</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {widgets.map((row) => (
              <Link
                key={row.kind}
                to={widgetHref(row.kind)}
                className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium ${
                  row.kind === widget ? "border-accent text-accent" : "border-slate-200 text-slate-500 hover:text-slate-900"
                }`}
              >
                {row.label}
              </Link>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-slate-500">{widgets.find((row) => row.kind === widget)?.description}</p>

          <Form method="get" className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="widget" value={widget} />
            <div>
              <label htmlFor="track" className="block text-[13px] font-medium text-slate-900">
                Track filter
              </label>
              <select id="track" name="track" defaultValue={filters.track} className={`${selectClass} mt-1 w-44`}>
                <option value="">All tracks</option>
                {trackNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="format" className="block text-[13px] font-medium text-slate-900">
                Format filter
              </label>
              <select id="format" name="format" defaultValue={filters.format} className={`${selectClass} mt-1 w-44`}>
                <option value="">All formats</option>
                {formatNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="height" className="block text-[13px] font-medium text-slate-900">
                Height
              </label>
              <input id="height" name="height" type="number" min={200} step={20} defaultValue={filters.height} className={`${inputClass} mt-1 w-28`} />
            </div>
            <button type="submit" className={buttonSecondary}>
              Apply
            </button>
          </Form>

          <h3 className="mt-5 text-sm font-semibold text-slate-900">Script embed, one line</h3>
          <p className="text-[13px] text-slate-500">Paste this into any page. It writes an iframe where the tag sits.</p>
          <textarea readOnly rows={3} value={snippets.script} aria-label="Script snippet" className={`${textareaClass} mt-1 font-mono text-xs`} />

          <h3 className="mt-4 text-sm font-semibold text-slate-900">HTML iframe</h3>
          <textarea readOnly rows={3} value={snippets.iframe} aria-label="Iframe snippet" className={`${textareaClass} mt-1 font-mono text-xs`} />

          <h3 className="mt-4 text-sm font-semibold text-slate-900">Data feeds</h3>
          <dl className="mt-1 space-y-2 text-[13px]">
            <div>
              <dt className="font-medium text-slate-500">JSON</dt>
              <dd>
                <a href={urls.json} className="break-all font-mono text-xs text-accent hover:underline">
                  {urls.json}
                </a>
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">iCal</dt>
              <dd>
                <a href={urls.ics} className="break-all font-mono text-xs text-accent hover:underline">
                  {urls.ics}
                </a>
              </dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Shareable page</dt>
              <dd>
                <a href={urls.widget} className="break-all font-mono text-xs text-accent hover:underline">
                  {urls.widget}
                </a>
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Preview</h2>
            <a href={urls.preview} target="_blank" rel="noreferrer" className={buttonSecondary}>
              Open in a new tab
            </a>
          </div>
          <iframe
            key={urls.preview}
            src={urls.preview}
            title={`${widget} preview`}
            className="mt-3 h-[640px] w-full rounded-md border border-slate-200"
          />
        </Card>
      </div>
    </>
  );
}
