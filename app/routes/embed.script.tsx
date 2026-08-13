// The one-line script embed. A site pastes:
//   <script src="https://host/embed/v1/<slug>/embed.js" data-widget="sessions"></script>
// and this writes an iframe in its place. Attributes: data-widget, data-height,
// data-track, data-format, data-room (content filters), data-accent and data-header
// (branding), data-v (cache version).
//
// data-saved="<id>" points at a saved embed instead: the widget, its filters, and its
// branding all come from the stored row, and the organizer can switch it off later
// without anyone editing this tag.

import type { Route } from "./+types/embed.script";
import { requirePublicEvent, publicCacheHeaders } from "../lib/public.server";

const WIDGETS = ["sessions", "speakers", "agenda", "itinerary", "gallery"];

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const event = await requirePublicEvent(String(params.eventSlug));
  const origin = url.origin;

  const script = `(function () {
  var script = document.currentScript;
  if (!script) return;
  var widgets = ${JSON.stringify(WIDGETS)};
  var widget = script.getAttribute("data-widget") || "sessions";
  if (widgets.indexOf(widget) === -1) widget = "sessions";
  var query = [];
  ["track", "format", "room", "day", "accent", "header", "v"].forEach(function (key) {
    var value = script.getAttribute("data-" + key);
    if (value) query.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
  });
  var saved = script.getAttribute("data-saved");
  var path = saved ? "saved/" + encodeURIComponent(saved) : widget;
  if (saved) {
    // The saved row owns the filters and the branding; only the cache version rides along.
    query = query.filter(function (pair) { return pair.indexOf("v=") === 0; });
  }
  var src = ${JSON.stringify(`${origin}/embed/v1/${event.slug}/`)} + path + (query.length ? "?" + query.join("&") : "");
  var frame = document.createElement("iframe");
  frame.src = src;
  frame.title = ${JSON.stringify(`${event.name} ${"program"}`)};
  frame.loading = "lazy";
  frame.style.width = "100%";
  frame.style.border = "0";
  frame.style.height = (script.getAttribute("data-height") || "720") + "px";
  script.parentNode.insertBefore(frame, script);
})();
`;

  return new Response(script, {
    headers: publicCacheHeaders(url, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    }),
  });
}
