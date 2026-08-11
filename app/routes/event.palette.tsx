// Search behind the Cmd+K palette. Resource route: JSON only, no component, so it
// follows the same pattern as the CSV exports (see CLAUDE.md).

import { and, eq, like, or } from "drizzle-orm";
import type { Route } from "./+types/event.palette";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import type { PaletteResults } from "../lib/palette";
import { contacts, eventContacts, sessions, statuses } from "../../database/schema";

const LIMIT = 6;

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();

  const empty: PaletteResults = { sessions: [], speakers: [] };
  if (q.length < 2) return Response.json(empty);

  const db = getDb();
  const needle = `%${q}%`;
  const base = `/admin/${eventId}`;

  // Drafts stay out: they are not visible to organizers anywhere else either.
  const sessionRows = await db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      statusLabel: statuses.label,
    })
    .from(sessions)
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(
      and(
        eq(sessions.eventId, eventId),
        eq(sessions.isDraft, false),
        or(like(sessions.title, needle), like(sessions.friendlyId, needle))
      )
    )
    .limit(LIMIT)
    .all();

  const speakerRows = await db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      company: contacts.company,
    })
    .from(eventContacts)
    .innerJoin(contacts, eq(eventContacts.contactId, contacts.id))
    .where(
      and(
        eq(eventContacts.eventId, eventId),
        or(like(contacts.firstName, needle), like(contacts.lastName, needle), like(contacts.email, needle))
      )
    )
    .limit(LIMIT)
    .all();

  const results: PaletteResults = {
    sessions: sessionRows.map((row) => ({
      to: `${base}/submissions/${row.id}`,
      label: row.title,
      hint: `${row.friendlyId}${row.statusLabel ? `, ${row.statusLabel}` : ""}`,
    })),
    speakers: speakerRows.map((row) => ({
      to: `${base}/speakers/${row.id}`,
      label: `${row.firstName} ${row.lastName}`.trim() || row.email,
      hint: row.company || row.email,
    })),
  };

  return Response.json(results);
}
