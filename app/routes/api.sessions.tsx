// POST /api/v1/event/:eventId/sessions  search, filters in a JSON body
// POST with {"create": {...}}            create a session
//
// Search and create share a path because that is the documented shape. A body
// carrying "create" is a write; anything else is a search.

import type { Route } from "./+types/api.sessions";
import { and, eq } from "drizzle-orm";
import { getDb } from "../lib/db.server";
import { apiError, corsPreflight, isResponse, json, paginate, readJsonBody, readPage, requireToken } from "../lib/api.server";
import { filterApiSessions, loadApiSessions, type SessionQuery } from "../lib/api-sessions.server";
import { nextFriendlyId } from "../lib/cfp.server";
import { events, sessions } from "../../database/schema";

async function requireEvent(eventId: number) {
  const db = getDb();
  return db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get();
}

export async function loader({ request, params }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  const auth = await requireToken(request);
  if (isResponse(auth)) return auth;

  const eventId = Number(params.eventId);
  if (!(await requireEvent(eventId))) return apiError(404, "not_found", `No event with id ${eventId}.`);

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
  if (!(await requireEvent(eventId))) return apiError(404, "not_found", `No event with id ${eventId}.`);

  const body = await readJsonBody(request);
  if (isResponse(body)) return body;

  if (request.method === "POST" && body.create) {
    const input = body.create as Record<string, unknown>;
    const title = String(input.title ?? "").trim();
    if (!title) return apiError(422, "missing_title", "A session needs a title.");

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
        trackId: Number(input.trackId) || null,
        formatId: Number(input.formatId) || null,
        levelId: Number(input.levelId) || null,
        roomId: Number(input.roomId) || null,
        statusId: Number(input.statusId) || null,
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
