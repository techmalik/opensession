// GET /api/v1/events: every event this installation runs.

import type { Route } from "./+types/api.events";
import { desc } from "drizzle-orm";
import { getDb } from "../lib/db.server";
import { apiError, corsPreflight, isResponse, json, paginate, readPage, requireToken } from "../lib/api.server";
import { events } from "../../database/schema";

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  const auth = await requireToken(request);
  if (isResponse(auth)) return auth;

  const db = getDb();
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      tagline: events.tagline,
      location: events.location,
      timezone: events.timezone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      status: events.status,
    })
    .from(events)
    .orderBy(desc(events.createdAt))
    .all();

  const url = new URL(request.url);
  return json(
    paginate(
      rows.map((row) => ({
        ...row,
        startsAt: row.startsAt?.toISOString() ?? null,
        endsAt: row.endsAt?.toISOString() ?? null,
      })),
      readPage(url)
    )
  );
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  return apiError(405, "method_not_allowed", "This endpoint only accepts GET.");
}
