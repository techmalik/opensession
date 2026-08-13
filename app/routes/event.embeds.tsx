// Embeds: the organizer's view of the five public widgets. Pick a widget, pick the
// filters and the branding, copy the snippet. Every URL carries the embed cache
// version, so the "Refresh embeds" button changes every snippet and pushes fresh data
// everywhere.
//
// EMB-15: a configuration can also be saved by name. A saved embed's snippet points
// at /embed/v1/:slug/saved/:id, which is what makes the enable/disable toggle below
// reach pages that were pasted months ago.

import { Form, Link, useSearchParams } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.embeds";
import { appBaseUrl, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { bumpEmbedCacheVersion, embedCacheVersion } from "../lib/settings.server";
import { DEFAULT_ACCENT, WIDGETS, normalizeHex, readBranding, type WidgetKind } from "../lib/embed-view";
import {
  createSavedEmbed,
  deleteSavedEmbed,
  listSavedEmbeds,
  setSavedEmbedEnabled,
  type SavedEmbedConfig,
} from "../lib/embeds.server";
import { events, formats, sessions, tracks } from "../../database/schema";
import {
  Card,
  ErrorNotice,
  Notice,
  PageHeader,
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  inputSized,
  selectClass,
  selectSized,
  textareaClass,
} from "../components/ui";

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
  const branding = readBranding(url.searchParams);

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
  // Branding params are omitted while they hold their defaults, so an untouched
  // configurator still produces the URL it always produced.
  if (branding.accent !== DEFAULT_ACCENT) query.set("accent", branding.accent);
  if (!branding.header) query.set("header", "0");
  query.set("v", String(version));

  const base = `${appBaseUrl()}/embed/v1/${event.slug}`;
  const widgetUrl = `${base}/${widget}?${query.toString()}`;
  const saved = await listSavedEmbeds(eventId);

  return {
    event,
    widget,
    widgets: WIDGETS,
    tracks: trackRows.map((row) => row.name),
    formats: formatRows.map((row) => row.name),
    filters: { track, format, height },
    branding,
    saved: saved.map((row) => ({
      id: row.id,
      name: row.name,
      widgetLabel: row.widgetLabel,
      widgetType: row.widgetType,
      enabled: row.enabled,
      summary: row.summary,
      snippet:
        `<iframe src="${base}/saved/${row.id}?v=${version}" title="${event.name} ${row.widgetLabel}" ` +
        `width="100%" height="${row.config.height}" style="border:0" loading="lazy"></iframe>`,
      scriptSnippet: `<script src="${base}/embed.js" data-saved="${row.id}" data-height="${row.config.height}" data-v="${version}"></script>`,
      url: `${base}/saved/${row.id}?v=${version}`,
    })),
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
        (branding.accent !== DEFAULT_ACCENT ? ` data-accent="${branding.accent}"` : "") +
        (branding.header ? "" : ` data-header="0"`) +
        ` data-height="${height}" data-v="${version}"></script>`,
      iframe: `<iframe src="${widgetUrl}" title="${event.name} ${widget}" width="100%" height="${height}" style="border:0" loading="lazy"></iframe>`,
    },
    counts: {
      held: publicRows.filter((row) => row.publicState === "held").length,
      scheduled: publicRows.filter((row) => row.startsAt != null).length,
    },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "refresh") {
    const version = await bumpEmbedCacheVersion();
    return {
      notice: `Embeds refreshed. Snippet URLs now carry v=${version}, so caches miss and reload the current data.`,
      error: null,
    };
  }

  if (intent === "save-embed") {
    const config: SavedEmbedConfig = {
      track: String(form.get("track") ?? ""),
      format: String(form.get("format") ?? ""),
      height: String(form.get("height") ?? "720"),
      accent: normalizeHex(String(form.get("accent") ?? "")) ?? DEFAULT_ACCENT,
      header: String(form.get("header") ?? "1") !== "0",
    };
    const row = await createSavedEmbed(eventId, String(form.get("name") ?? ""), String(form.get("widget") ?? ""), config);
    if (!row) return { notice: null, error: "Give the saved embed a name." };
    return { notice: `Saved "${row.name}". Its snippet keeps working while it stays enabled.`, error: null };
  }

  if (intent === "toggle-embed") {
    const enabled = String(form.get("enabled") ?? "") === "1";
    const ok = await setSavedEmbedEnabled(eventId, Number(form.get("savedId") ?? 0), enabled);
    if (!ok) return { notice: null, error: "That saved embed is not on this event." };
    return {
      notice: enabled
        ? "Saved embed enabled. Pages carrying its snippet show the widget again."
        : "Saved embed disabled. Pages carrying its snippet now render nothing.",
      error: null,
    };
  }

  if (intent === "delete-embed") {
    const ok = await deleteSavedEmbed(eventId, Number(form.get("savedId") ?? 0));
    if (!ok) return { notice: null, error: "That saved embed is not on this event." };
    return { notice: "Saved embed deleted. Any page carrying its snippet now renders nothing.", error: null };
  }

  return { notice: null, error: null };
}

export default function Embeds({ loaderData, actionData }: Route.ComponentProps) {
  const { event, widget, widgets, tracks: trackNames, formats: formatNames, filters, branding, saved, version, urls, snippets, counts } =
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

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}
      <Notice>
        Widgets show accepted, scheduled sessions that are published to public. {counts.scheduled} scheduled,{" "}
        {counts.held} held from public.
      </Notice>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px] [&>*]:min-w-0">
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
            <div>
              <label htmlFor="accent" className="block text-[13px] font-medium text-slate-900">
                Accent color
              </label>
              <input
                id="accent"
                name="accent"
                type="text"
                pattern="#?[0-9a-fA-F]{6}"
                defaultValue={branding.accent}
                aria-describedby="accent-help"
                className={`${inputSized} mt-1 w-28 font-mono`}
              />
            </div>
            <div>
              <label htmlFor="header" className="block text-[13px] font-medium text-slate-900">
                Widget header
              </label>
              <select id="header" name="header" defaultValue={branding.header ? "1" : "0"} className={`${selectSized} mt-1 w-32`}>
                <option value="1">Show</option>
                <option value="0">Hide</option>
              </select>
            </div>
            <button type="submit" className={buttonSecondary}>
              Apply
            </button>
          </Form>
          <p id="accent-help" className="mt-1.5 text-[13px] text-slate-500">
            Branding is applied server-side, so the widgets stay script-free. Pick a color dark enough to read as white
            text on a filled button. Default is {DEFAULT_ACCENT}.
          </p>

          <Form method="post" className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4">
            <input type="hidden" name="widget" value={widget} />
            <input type="hidden" name="track" value={filters.track} />
            <input type="hidden" name="format" value={filters.format} />
            <input type="hidden" name="height" value={filters.height} />
            <input type="hidden" name="accent" value={branding.accent} />
            <input type="hidden" name="header" value={branding.header ? "1" : "0"} />
            <div className="min-w-0 flex-1">
              <label htmlFor="saved-name" className="block text-[13px] font-medium text-slate-900">
                Save this embed
              </label>
              <input
                id="saved-name"
                name="name"
                type="text"
                maxLength={120}
                required
                placeholder="Homepage sessions list"
                className={`${inputSized} mt-1 w-full`}
              />
            </div>
            <button type="submit" name="intent" value="save-embed" className={buttonSecondary}>
              Save embed
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

      <Card className="mt-4">
        <div className="border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-900">Saved embeds</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Named configurations with their own stable snippet. Disabling one empties every page that already carries
            its snippet, without anyone editing their HTML.
          </p>
        </div>

        {saved.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">
            Nothing saved yet. Configure a widget above, name it, and Save embed.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th scope="col" className="px-4 py-2 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2 font-medium">Widget</th>
                  <th scope="col" className="px-4 py-2 font-medium">Configuration</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Snippet</th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {saved.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="px-4 py-2 font-medium text-slate-900">{row.name}</td>
                    <td className="px-4 py-2 text-slate-900">{row.widgetLabel}</td>
                    <td className="px-4 py-2 text-slate-500">{row.summary}</td>
                    <td className="px-4 py-2">
                      <span className={row.enabled ? "text-slate-900" : "text-slate-500"}>
                        {row.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <textarea
                        readOnly
                        rows={2}
                        value={row.snippet}
                        aria-label={`Iframe snippet for ${row.name}`}
                        className={`${textareaClass} w-[280px] font-mono text-xs`}
                      />
                      <textarea
                        readOnly
                        rows={2}
                        value={row.scriptSnippet}
                        aria-label={`Script snippet for ${row.name}`}
                        className={`${textareaClass} mt-1 w-[280px] font-mono text-xs`}
                      />
                      <a href={row.url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-medium text-accent hover:underline">
                        Open
                      </a>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Form method="post">
                          <input type="hidden" name="savedId" value={row.id} />
                          <input type="hidden" name="enabled" value={row.enabled ? "0" : "1"} />
                          <button type="submit" name="intent" value="toggle-embed" className={buttonSecondary}>
                            {row.enabled ? "Disable" : "Enable"}
                          </button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="savedId" value={row.id} />
                          <button type="submit" name="intent" value="delete-embed" className={buttonDanger}>
                            Delete
                          </button>
                        </Form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
