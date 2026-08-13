// A saved embed's stable URL: /embed/v1/:eventSlug/saved/:savedId
//
// Enabled, it redirects to the widget URL its stored configuration describes, so the
// widget rendering path is exactly the one every other embed uses. Disabled (or
// deleted, or belonging to another event), it answers 200 with an empty document, so
// a page that pasted the snippet months ago simply shows nothing rather than an
// error frame. Either way there is no script and no data leak.

import type { Route } from "./+types/embed.saved";
import { publicCacheHeaders, requirePublicEvent } from "../lib/public.server";
import { findSavedEmbed, savedEmbedQuery } from "../lib/embeds.server";
import { embedCacheVersion } from "../lib/settings.server";

const EMPTY_DOCUMENT =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="robots" content="noindex"><title>Embed disabled</title></head>' +
  '<body style="margin:0"><div data-opensession-embed="disabled"></div></body></html>';

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const event = await requirePublicEvent(String(params.eventSlug));
  const saved = await findSavedEmbed(event.id, Number(params.savedId));

  if (!saved || !saved.enabled) {
    return new Response(EMPTY_DOCUMENT, {
      headers: publicCacheHeaders(url, { "Content-Type": "text/html; charset=utf-8" }),
    });
  }

  // The snippet's own ?v= wins when present: that is what "Refresh embeds" changes.
  const version = Number(url.searchParams.get("v")) || (await embedCacheVersion());
  const query = savedEmbedQuery(saved.config, version);
  const headers = publicCacheHeaders(url, {
    Location: `/embed/v1/${event.slug}/${saved.widgetType}?${query.toString()}`,
  });
  return new Response(null, { status: 302, headers });
}
