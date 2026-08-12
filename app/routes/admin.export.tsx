// Resource route: no component, so the loader's Response is returned as-is. A loader
// that also renders a component cannot return a raw Response, so every CSV export in
// this app gets its own route like this one.

import { and, desc, eq, like, or, sql } from "drizzle-orm";
import type { Route } from "./+types/admin.export";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { csvResponse, toCsv } from "../lib/format";
import { eventAccessFilter } from "../lib/events.server";
import { events } from "../../database/schema";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const status = url.searchParams.get("status") ?? "";

  const filters = [
    // Same scoping as the list this exports.
    eventAccessFilter(user),
    q ? or(like(events.name, `%${q}%`), like(events.location, `%${q}%`)) : undefined,
    status === "draft" || status === "active" || status === "archived" ? eq(events.status, status) : undefined,
  ].filter(Boolean);

  const db = getDb();
  const rows = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      location: events.location,
      timezone: events.timezone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      status: events.status,
      submissionCount: sql<number>`(
        select count(*) from sessions
        where sessions.event_id = ${events.id} and sessions.is_abstract = 1 and sessions.is_draft = 0
      )`,
    })
    .from(events)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(events.createdAt))
    .all();

  const csv = toCsv(
    ["id", "name", "slug", "location", "timezone", "starts_at", "ends_at", "status", "submissions"],
    rows.map((r) => [
      r.id,
      r.name,
      r.slug,
      r.location,
      r.timezone,
      r.startsAt ? r.startsAt.toISOString() : "",
      r.endsAt ? r.endsAt.toISOString() : "",
      r.status,
      r.submissionCount,
    ])
  );

  return csvResponse("events.csv", csv);
}
