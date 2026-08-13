// Which events an API token may touch.
//
// One rule for both token surfaces, REST and MCP: a token reaches exactly the events
// the organizer who created it can open, through the same canAccessEvent /
// eventAccessFilter used by the admin UI. There is no installation-wide tier. A
// token whose creator was never recorded, or whose creator has since been deleted,
// reaches nothing: failing closed is the only safe reading of "we do not know who
// this belongs to".

import { and, eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { canAccessEvent, eventAccessFilter, type EventOwner } from "./events.server";
import { apiTokens, events, users } from "../../database/schema";

export interface TokenScope {
  tokenId: number;
  tokenName: string;
  /** Null means the token has no reachable creator, and therefore no reach. */
  user: EventOwner | null;
}

export const CREATORLESS_TOKEN_MESSAGE =
  "This token has no recorded owner, so it has no event access. Create a new token in Settings, API and use that one.";

export async function scopeForToken(tokenId: number, tokenName: string): Promise<TokenScope> {
  const db = getDb();
  const token = await db
    .select({ createdBy: apiTokens.createdBy })
    .from(apiTokens)
    .where(eq(apiTokens.id, tokenId))
    .get();

  if (!token?.createdBy) return { tokenId, tokenName, user: null };

  const user = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, token.createdBy))
    .get();

  return { tokenId, tokenName, user: user ?? null };
}

export type ScopedEventRow = typeof events.$inferSelect;

/** Every event this token reaches, newest first. */
export async function scopedEvents(scope: TokenScope): Promise<ScopedEventRow[]> {
  if (!scope.user) return [];
  const db = getDb();
  const filter = eventAccessFilter(scope.user);
  const query = db.select().from(events);
  const rows = filter ? await query.where(filter).all() : await query.all();
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** The event, or null when it does not exist or this token cannot reach it. The two
 *  cases are answered the same way on purpose: a token must not be able to probe
 *  another organizer's event ids. */
export async function scopedEvent(scope: TokenScope, eventId: number): Promise<ScopedEventRow | null> {
  if (!scope.user) return null;
  if (!Number.isInteger(eventId)) return null;
  const db = getDb();
  const row = await db.select().from(events).where(and(eq(events.id, eventId))).get();
  if (!row) return null;
  if (!canAccessEvent(scope.user, row)) return null;
  return row;
}
