// /sessions, /speakers, /agenda, /schedule, /gallery: the paths a visitor guesses
// before they know the event slug. Each redirects to the matching widget for the
// featured event (Settings > Featured event), falling back to the most recent
// active event. With no active event there is nothing public to show, so this
// falls back to the home page rather than a dead end.

import { redirect } from "react-router";
import type { Route } from "./+types/public-alias";
import { featuredActiveEvent } from "../lib/events.server";

const WIDGET_FOR: Record<string, string> = {
  sessions: "sessions",
  speakers: "speakers",
  agenda: "agenda",
  schedule: "itinerary",
  gallery: "gallery",
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const key = url.pathname.replace(/^\//, "").toLowerCase();
  const widget = WIDGET_FOR[key] ?? "sessions";

  const event = await featuredActiveEvent();

  if (!event) return redirect("/");
  return redirect(`/embed/v1/${event.slug}/${widget}${url.search}`);
}
