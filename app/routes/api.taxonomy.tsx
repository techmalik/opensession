// GET /api/v1/event/:eventId/{contacts,statuses,tracks,formats,rooms}
//
// One module for the five read-only collections: identical envelope, identical
// auth, and the last path segment picks the table.

import type { Route } from "./+types/api.taxonomy";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../lib/db.server";
import { apiError, corsPreflight, isResponse, json, paginate, readPage, requireToken } from "../lib/api.server";
import {
  contacts,
  eventContacts,
  events,
  formats,
  rooms,
  sessionParticipants,
  sessions,
  statuses,
  tracks,
} from "../../database/schema";

export async function loader({ request, params }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  const auth = await requireToken(request);
  if (isResponse(auth)) return auth;

  const eventId = Number(params.eventId);
  const db = getDb();
  const event = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).get();
  if (!event) return apiError(404, "not_found", `No event with id ${eventId}.`);

  const url = new URL(request.url);
  const collection = url.pathname.split("/").pop() ?? "";
  const page = readPage(url);

  switch (collection) {
    case "tracks": {
      const rows = await db
        .select({ id: tracks.id, name: tracks.name, color: tracks.color, sort: tracks.sort })
        .from(tracks)
        .where(eq(tracks.eventId, eventId))
        .orderBy(asc(tracks.sort), asc(tracks.id))
        .all();
      return json(paginate(rows, page));
    }
    case "formats": {
      const rows = await db
        .select({ id: formats.id, name: formats.name, durationMin: formats.durationMin, sort: formats.sort })
        .from(formats)
        .where(eq(formats.eventId, eventId))
        .orderBy(asc(formats.sort), asc(formats.id))
        .all();
      return json(paginate(rows, page));
    }
    case "rooms": {
      const rows = await db
        .select({ id: rooms.id, name: rooms.name, capacity: rooms.capacity, sort: rooms.sort })
        .from(rooms)
        .where(eq(rooms.eventId, eventId))
        .orderBy(asc(rooms.sort), asc(rooms.id))
        .all();
      return json(paginate(rows, page));
    }
    case "statuses": {
      const rows = await db
        .select({ id: statuses.id, key: statuses.key, label: statuses.label, color: statuses.color, isSystem: statuses.isSystem })
        .from(statuses)
        .where(eq(statuses.eventId, eventId))
        .orderBy(asc(statuses.sort), asc(statuses.id))
        .all();
      return json(paginate(rows, page));
    }
    case "contacts": {
      const links = await db
        .select({ contactId: eventContacts.contactId, kind: eventContacts.kind, status: eventContacts.status })
        .from(eventContacts)
        .where(eq(eventContacts.eventId, eventId))
        .all();

      // Anyone on a session for this event counts too, roster row or not.
      const onSessions = await db
        .select({ contactId: sessionParticipants.contactId })
        .from(sessionParticipants)
        .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
        .where(eq(sessions.eventId, eventId))
        .all();

      const ids = [...new Set([...links.map((row) => row.contactId), ...onSessions.map((row) => row.contactId)])];
      if (ids.length === 0) return json(paginate([], page));

      const people = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
          title: contacts.title,
          company: contacts.company,
          bio: contacts.bio,
        })
        .from(contacts)
        .where(inArray(contacts.id, ids))
        .orderBy(asc(contacts.lastName), asc(contacts.firstName))
        .all();

      return json(
        paginate(
          people.map((person) => {
            const link = links.find((row) => row.contactId === person.id);
            return {
              id: person.id,
              name: `${person.firstName} ${person.lastName}`.trim() || person.email,
              firstName: person.firstName,
              lastName: person.lastName,
              email: person.email,
              title: person.title,
              company: person.company,
              bio: person.bio,
              kind: link?.kind ?? "speaker",
              rosterStatus: link?.status ?? null,
            };
          }),
          page
        )
      );
    }
    default:
      return apiError(404, "unknown_collection", `No collection named ${collection}.`);
  }
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") return corsPreflight();
  return apiError(405, "method_not_allowed", "These collections are read-only.");
}
