// POST /api/v1/event/:eventId/sessions  search, filters in a JSON body
// POST with {"create": {...}}            create a session
//
// Search and create share a path because that is the documented shape. A body
// carrying "create" is a write; anything else is a search.

import type { Route } from "./+types/api.sessions";
import { and, eq } from "drizzle-orm";
import { getDb } from "../lib/db.server";
import { apiError, corsPreflight, isResponse, json, paginate, readJsonBody, readPage, requireToken, tokenEvent } from "../lib/api.server";
import { filterApiSessions, loadApiSessions, type SessionQuery } from "../lib/api-sessions.server";
import { nextFriendlyId } from "../lib/cfp.server";
import { formats, levels, rooms, sessions, statuses, tracks } from "../../database/schema";

/** A taxonomy id is only accepted when the row it names belongs to this event.
 *  Otherwise a create could attach another event's track, room, or status and
 *  corrupt every join that reads them together. */
async function ownedId(
  table: typeof tracks | typeof formats | typeof levels | typeof rooms | typeof statuses,
  eventId: number,
  raw: unknown
): Promise<{ id: number | null } | { error: string }> {
  const id = Number(raw) || null;
  if (!id) return { id: null };
  const db = getDb();
  const row = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.eventId, eventId)))
    .get();
  return row ? { id: row.id } : { error: `id ${id} does not belong to event ${eventId}.` };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  const auth = await requireToken(request);
  if (isResponse(auth)) return auth;

  const eventId = Number(params.eventId);
  if (!(await tokenEvent(auth, eventId))) return apiError(404, "not_found", `No event with id ${eventId}.`);

  // GET is a convenience: the documented search is POST, but a plain list should
  // not require a body.
  const url = new URL(request.url);
  const rows = await loadApiSessions(eventId);
  return json(paginate(rows, readPage(url)));
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  const auth = await requireToken(request);
  if (isResponse(auth)) return auth;

  const eventId = Number(params.eventId);
  if (!(await tokenEvent(auth, eventId))) return apiError(404, "not_found", `No event with id ${eventId}.`);

  const body = await readJsonBody(request);
  if (isResponse(body)) return body;

  if (request.method === "POST" && body.create) {
    const input = body.create as Record<string, unknown>;
    const title = String(input.title ?? "").trim();
    if (!title) return apiError(422, "missing_title", "A session needs a title.");

    const refs = {
      trackId: await ownedId(tracks, eventId, input.trackId),
      formatId: await ownedId(formats, eventId, input.formatId),
      levelId: await ownedId(levels, eventId, input.levelId),
      roomId: await ownedId(rooms, eventId, input.roomId),
      statusId: await ownedId(statuses, eventId, input.statusId),
    };
    for (const [field, result] of Object.entries(refs)) {
      if ("error" in result) return apiError(422, "invalid_reference", `${field}: ${result.error}`);
    }

    const db = getDb();
    const now = new Date();
    const created = await db
      .insert(sessions)
      .values({
        eventId,
        friendlyId: await nextFriendlyId(),
        title,
        abstract: input.abstract == null ? null : String(input.abstract),
        isAbstract: input.isAbstract === false ? false : true,
        isDraft: input.isDraft === true,
        trackId: (refs.trackId as { id: number | null }).id,
        formatId: (refs.formatId as { id: number | null }).id,
        levelId: (refs.levelId as { id: number | null }).id,
        roomId: (refs.roomId as { id: number | null }).id,
        statusId: (refs.statusId as { id: number | null }).id,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: sessions.id })
      .get();

    const [row] = await loadApiSessions(eventId, [created.id]);
    return json({ data: row }, 201);
  }

  if (request.method !== "POST") return apiError(405, "method_not_allowed", "This endpoint accepts POST.");

  const url = new URL(request.url);
  const rows = await loadApiSessions(eventId);
  const filtered = filterApiSessions(rows, (body.query ?? body) as SessionQuery);
  return json(paginate(filtered, readPage(url, body)));
}
