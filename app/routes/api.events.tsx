// GET /api/v1/events: every event this token's owner can open.

import type { Route } from "./+types/api.events";
import { apiError, corsPreflight, isResponse, json, paginate, readPage, requireToken, tokenEvents } from "../lib/api.server";

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  const auth = await requireToken(request);
  if (isResponse(auth)) return auth;

  const rows = await tokenEvents(auth);

  const url = new URL(request.url);
  return json(
    paginate(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        tagline: row.tagline,
        location: row.location,
        timezone: row.timezone,
        startsAt: row.startsAt?.toISOString() ?? null,
        endsAt: row.endsAt?.toISOString() ?? null,
        status: row.status,
      })),
      readPage(url)
    )
  );
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  return apiError(405, "method_not_allowed", "This endpoint only accepts GET.");
}
