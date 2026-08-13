// The public API's shared machinery: token auth, pagination, and JSON errors.
//
// Auth is an x-access-token header checked against api_tokens. Only the SHA-256 of
// a token is stored, so a leaked database does not hand over working credentials,
// and the plaintext is shown to the organizer exactly once at creation.

import { eq } from "drizzle-orm";
import { getDb } from "./db.server";
import {
  CREATORLESS_TOKEN_MESSAGE,
  scopeForToken,
  scopedEvent,
  scopedEvents,
  type ScopedEventRow,
  type TokenScope,
} from "./token-scope.server";
import { apiTokens } from "../../database/schema";

export interface ApiError {
  error: { code: string; message: string };
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      // Read-only clients are often browser dashboards on another origin.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "x-access-token, content-type",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      ...extra,
    },
  });
}

export function apiError(status: number, code: string, message: string): Response {
  return json({ error: { code, message } } satisfies ApiError, status);
}

/** Tokens are compared by hash, never by string. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const body = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `osk_${body}`;
}

export interface AuthedToken {
  id: number;
  name: string;
  /** The organizer this token belongs to, and therefore what it can reach. */
  createdBy: number;
  scope: TokenScope;
}

/** Returns the token row, or a 401/403 Response to hand straight back.
 *
 *  A token is not installation-wide. It carries its creator, and every handler
 *  filters through that creator's event access, so an account created at /signup
 *  cannot mint a key that reads another organizer's submissions. A token with no
 *  reachable creator is refused outright rather than quietly granted everything. */
export async function requireToken(request: Request): Promise<AuthedToken | Response> {
  const presented = request.headers.get("x-access-token")?.trim();
  if (!presented) {
    return apiError(401, "missing_token", "Send your key in an x-access-token header. Create one in Settings, API.");
  }

  const db = getDb();
  const hash = await hashToken(presented);
  const row = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).get();
  if (!row) return apiError(401, "invalid_token", "That access token is not valid.");

  // Best-effort: a failed write here must not fail the request.
  try {
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  } catch {
    /* ignore */
  }

  const scope = await scopeForToken(row.id, row.name);
  if (!row.createdBy || !scope.user) return apiError(403, "unowned_token", CREATORLESS_TOKEN_MESSAGE);

  return { id: row.id, name: row.name, createdBy: row.createdBy, scope };
}

/** Every event this token may read, newest first. */
export function tokenEvents(auth: AuthedToken): Promise<ScopedEventRow[]> {
  return scopedEvents(auth.scope);
}

/** The event, or null when it does not exist or this token cannot reach it. Callers
 *  answer both with the same 404, so ids cannot be probed. */
export function tokenEvent(auth: AuthedToken, eventId: number): Promise<ScopedEventRow | null> {
  return scopedEvent(auth.scope, eventId);
}

export interface Page {
  page: number;
  pageSize: number;
}

export function readPage(url: URL, body?: Record<string, unknown>): Page {
  const raw = (key: string) => body?.[key] ?? url.searchParams.get(key);
  const page = Math.max(1, Number(raw("page") ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(raw("pageSize") ?? 25) || 25));
  return { page, pageSize };
}

/** Every list response has the same envelope, so a client writes its paging loop
 *  once. */
export function paginate<T>(rows: T[], page: Page): { data: T[]; page: number; pageSize: number; total: number; totalPages: number } {
  const start = (page.page - 1) * page.pageSize;
  return {
    data: rows.slice(start, start + page.pageSize),
    page: page.page,
    pageSize: page.pageSize,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / page.pageSize)),
  };
}

/** Body parser that never throws: a malformed body becomes a 400, not a 500. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (request.method === "GET" || request.method === "DELETE") return {};
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return apiError(400, "invalid_body", "The request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    return apiError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/** Preflight for browser clients. */
export function corsPreflight(): Response {
  return json({}, 204);
}
