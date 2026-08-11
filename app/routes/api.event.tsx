// GET /api/v1/event/:eventId: one event with its counts.

import type { Route } from "./+types/api.event";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db.server";
import { apiError, corsPreflight, isResponse, json, requireToken } from "../lib/api.server";
import { events, sessions, statuses } from "../../database/schema";

export async function loader({ request, params }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  const auth = await requireToken(request);
  if (isResponse(auth)) return auth;

  const eventId = Number(params.eventId);
  if (!Number.isInteger(eventId)) return apiError(400, "invalid_id", "The event id must be a number.");

  const db = getDb();
  const event = await db.select().from(events).where(eq(events.id, eventId)).get();
  if (!event) return apiError(404, "not_found", `No event with id ${eventId}.`);

  // The public count has to mean what a visitor would actually see, which is the
  // same gate the widgets read: accepted, scheduled, not a draft, not held.
  const all = await db
    .select({
      id: sessions.id,
      isAbstract: sessions.isAbstract,
      isDraft: sessions.isDraft,
      publicState: sessions.publicState,
      startsAt: sessions.startsAt,
      roomId: sessions.roomId,
      statusKey: statuses.key,
    })
    .from(sessions)
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(eq(sessions.eventId, eventId))
    .all();

  const publicRows = all.filter(
    (row) =>
      row.statusKey === "accepted" &&
      row.publicState === "published" &&
      !row.isDraft &&
      row.startsAt != null &&
      row.roomId != null
  );

  return json({
    data: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      tagline: event.tagline,
      description: event.description,
      location: event.location,
      timezone: event.timezone,
      startsAt: event.startsAt?.toISOString() ?? null,
      endsAt: event.endsAt?.toISOString() ?? null,
      status: event.status,
      agendaPublishedAt: event.agendaPublishedAt?.toISOString() ?? null,
      counts: {
        submissions: all.filter((row) => row.isAbstract).length,
        sessions: all.filter((row) => !row.isAbstract).length,
        publishedPublicly: publicRows.length,
      },
    },
  });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  return apiError(405, "method_not_allowed", "This endpoint only accepts GET.");
}
