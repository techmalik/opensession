// GET, PATCH, DELETE /api/v1/event/:eventId/sessions/:sessionId

import type { Route } from "./+types/api.session";
import { and, eq } from "drizzle-orm";
import { getDb } from "../lib/db.server";
import { apiError, corsPreflight, isResponse, json, readJsonBody, requireToken } from "../lib/api.server";
import { loadApiSessions } from "../lib/api-sessions.server";
import { sessionParticipants, sessions, statuses } from "../../database/schema";

async function owned(eventId: number, sessionId: number) {
  const db = getDb();
  return db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)))
    .get();
}

export async function loader({ request, params }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  const auth = await requireToken(request);
  if (isResponse(auth)) return auth;

  const eventId = Number(params.eventId);
  const sessionId = Number(params.sessionId);
  if (!(await owned(eventId, sessionId))) return apiError(404, "not_found", `No session ${sessionId} on event ${eventId}.`);

  const [row] = await loadApiSessions(eventId, [sessionId]);
  return json({ data: row });
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  const auth = await requireToken(request);
  if (isResponse(auth)) return auth;

  const eventId = Number(params.eventId);
  const sessionId = Number(params.sessionId);
  if (!(await owned(eventId, sessionId))) return apiError(404, "not_found", `No session ${sessionId} on event ${eventId}.`);

  const db = getDb();

  if (request.method === "DELETE") {
    await db.delete(sessionParticipants).where(eq(sessionParticipants.sessionId, sessionId));
    await db.delete(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)));
    return json({ data: { id: sessionId, deleted: true } });
  }

  if (request.method !== "PATCH" && request.method !== "POST") {
    return apiError(405, "method_not_allowed", "This endpoint accepts GET, PATCH, and DELETE.");
  }

  const body = await readJsonBody(request);
  if (isResponse(body)) return body;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.title === "string") {
    if (!body.title.trim()) return apiError(422, "missing_title", "A session needs a title.");
    patch.title = body.title.trim();
  }
  if ("abstract" in body) patch.abstract = body.abstract == null ? null : String(body.abstract);
  if ("trackId" in body) patch.trackId = Number(body.trackId) || null;
  if ("formatId" in body) patch.formatId = Number(body.formatId) || null;
  if ("levelId" in body) patch.levelId = Number(body.levelId) || null;
  if ("roomId" in body) patch.roomId = Number(body.roomId) || null;
  if ("isDraft" in body) patch.isDraft = body.isDraft === true;
  if ("publicState" in body) {
    const state = String(body.publicState);
    if (state !== "published" && state !== "held") {
      return apiError(422, "invalid_public_state", 'publicState must be "published" or "held".');
    }
    patch.publicState = state;
  }
  if ("startsAt" in body) {
    const value = body.startsAt == null ? null : new Date(String(body.startsAt));
    if (value && Number.isNaN(value.getTime())) return apiError(422, "invalid_date", "startsAt must be an ISO 8601 timestamp.");
    patch.startsAt = value;
  }
  if ("endsAt" in body) {
    const value = body.endsAt == null ? null : new Date(String(body.endsAt));
    if (value && Number.isNaN(value.getTime())) return apiError(422, "invalid_date", "endsAt must be an ISO 8601 timestamp.");
    patch.endsAt = value;
  }

  // Status carries a side effect the rest of the app relies on: accepted work stops
  // being an abstract and becomes a session.
  if ("statusId" in body || "status" in body) {
    const wanted = "statusId" in body ? Number(body.statusId) : null;
    const status = wanted
      ? await db.select().from(statuses).where(and(eq(statuses.eventId, eventId), eq(statuses.id, wanted))).get()
      : await db
          .select()
          .from(statuses)
          .where(and(eq(statuses.eventId, eventId), eq(statuses.key, String(body.status))))
          .get();
    if (!status) return apiError(422, "invalid_status", "That status does not exist on this event.");
    patch.statusId = status.id;
    patch.isAbstract = status.key !== "accepted";
  }

  await db.update(sessions).set(patch).where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)));
  const [row] = await loadApiSessions(eventId, [sessionId]);
  return json({ data: row });
}
