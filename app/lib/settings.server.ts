// Key/value settings, JSON in a single table. Used by the embed cache version and
// by the Airtable and Accelevents integration config.

import { eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { settings } from "../../database/schema";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = getDb();
  const row = await db.select({ valueJson: settings.valueJson }).from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = getDb();
  await db
    .insert(settings)
    .values({ key, valueJson: JSON.stringify(value), updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: JSON.stringify(value), updatedAt: new Date() } });
}

export const FEATURED_EVENT_SLUG_KEY = "featured_event_slug";
export const DEFAULT_FEATURED_EVENT_SLUG = "meridian-dev-summit-2027";

/** The event the landing page and the /agenda-style alias routes resolve to.
 *  Without this, any visitor who creates an event takes over the homepage. */
export async function featuredEventSlug(): Promise<string> {
  const value = await getSetting<string>(FEATURED_EVENT_SLUG_KEY, DEFAULT_FEATURED_EVENT_SLUG);
  return typeof value === "string" && value ? value : DEFAULT_FEATURED_EVENT_SLUG;
}

export const EMBED_CACHE_VERSION_KEY = "embed_cache_version";

/** Part of every embed URL. Bumping it changes the URL, so caches at the edge and in
 *  the browser miss and the widget re-renders with current data. */
export async function embedCacheVersion(): Promise<number> {
  const value = await getSetting<number>(EMBED_CACHE_VERSION_KEY, 1);
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

export async function bumpEmbedCacheVersion(): Promise<number> {
  const next = (await embedCacheVersion()) + 1;
  await setSetting(EMBED_CACHE_VERSION_KEY, next);
  return next;
}
