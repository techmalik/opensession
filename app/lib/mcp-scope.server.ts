// Which events an MCP token may touch.
//
// The public API is deliberately installation-wide: its own screen says so, and its
// handlers are untouched. The MCP server is stricter. A token created after the
// created_by column shipped carries its organizer, and every tool is filtered
// through the same canAccessEvent / eventAccessFilter rules the admin uses. A token
// with no recorded creator keeps the API's reach, so nothing that worked before
// this module existed stopped working.

import { and, eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { canAccessEvent, eventAccessFilter, type EventOwner } from "./events.server";
import { apiTokens, events, users } from "../../database/schema";

export interface TokenScope {
  tokenId: number;
  tokenName: string;
  /** Null means the token predates creator tracking: API-wide reach. */
  user: EventOwner | null;
}

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
  const db = getDb();
  const filter = scope.user ? eventAccessFilter(scope.user) : undefined;
  const query = db.select().from(events);
  const rows = filter ? await query.where(filter).all() : await query.all();
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** The event, or null when it does not exist or this token cannot reach it. The two
 *  cases are answered the same way on purpose: a token must not be able to probe
 *  another organizer's event ids. */
export async function scopedEvent(scope: TokenScope, eventId: number): Promise<ScopedEventRow | null> {
  if (!Number.isInteger(eventId)) return null;
  const db = getDb();
  const row = await db.select().from(events).where(and(eq(events.id, eventId))).get();
  if (!row) return null;
  if (scope.user && !canAccessEvent(scope.user, row)) return null;
  return row;
}
