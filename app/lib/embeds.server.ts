// EMB-15: saved embeds. A named widget configuration an organizer can hand out and
// later switch off without touching the HTML anyone pasted.
//
// The snippet points at /embed/v1/:slug/saved/:id rather than at the widget itself.
// That one indirection is the whole feature: the route reads `enabled` on every
// request, so disabling a saved embed empties every page carrying it. The widget
// routes themselves are untouched, so the plain widget URLs behave exactly as before.

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./db.server";
import {
  DEFAULT_ACCENT,
  WIDGETS,
  brandingParams,
  normalizeHex,
  type WidgetKind,
} from "./embed-view";
import { savedEmbeds } from "../../database/schema";

export interface SavedEmbedConfig {
  track: string;
  format: string;
  height: string;
  accent: string;
  header: boolean;
}

export const DEFAULT_SAVED_CONFIG: SavedEmbedConfig = {
  track: "",
  format: "",
  height: "720",
  accent: DEFAULT_ACCENT,
  header: true,
};

export interface SavedEmbedRow {
  id: number;
  name: string;
  widgetType: WidgetKind;
  widgetLabel: string;
  config: SavedEmbedConfig;
  enabled: boolean;
  createdAt: Date;
  summary: string;
}

function widgetKind(value: string): WidgetKind {
  return (WIDGETS.find((row) => row.kind === value)?.kind ?? "sessions") as WidgetKind;
}

/** Anything stored is re-validated on read. A hand-edited config_json can never put
 *  an arbitrary string into a style attribute or an iframe height. */
export function parseConfig(json: string): SavedEmbedConfig {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const height = Math.round(Number(raw.height));
  return {
    track: typeof raw.track === "string" ? raw.track : "",
    format: typeof raw.format === "string" ? raw.format : "",
    height: Number.isFinite(height) && height >= 200 && height <= 4000 ? String(height) : DEFAULT_SAVED_CONFIG.height,
    accent: normalizeHex(typeof raw.accent === "string" ? raw.accent : null) ?? DEFAULT_ACCENT,
    header: raw.header !== false,
  };
}

function summarize(config: SavedEmbedConfig): string {
  return [
    config.track || "All tracks",
    config.format || "All formats",
    `${config.height}px`,
    config.accent === DEFAULT_ACCENT ? "Default accent" : `Accent ${config.accent}`,
    config.header ? "Header shown" : "Header hidden",
  ].join(", ");
}

/** The query string a saved embed's widget URL carries. Filters first, then only the
 *  branding params that differ from the default, so a plain saved embed resolves to
 *  the same URL the configurator has always produced. */
export function savedEmbedQuery(config: SavedEmbedConfig, version: number): URLSearchParams {
  const query = new URLSearchParams();
  if (config.track) query.set("track", config.track);
  if (config.format) query.set("format", config.format);
  for (const [key, value] of brandingParams({ accent: config.accent, accentHover: "", header: config.header })) {
    query.set(key, value);
  }
  query.set("v", String(version));
  return query;
}

function toRow(row: typeof savedEmbeds.$inferSelect): SavedEmbedRow {
  const config = parseConfig(row.configJson);
  const kind = widgetKind(row.widgetType);
  return {
    id: row.id,
    name: row.name,
    widgetType: kind,
    widgetLabel: WIDGETS.find((widget) => widget.kind === kind)?.label ?? kind,
    config,
    enabled: row.enabled,
    createdAt: row.createdAt,
    summary: summarize(config),
  };
}

export async function listSavedEmbeds(eventId: number): Promise<SavedEmbedRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(savedEmbeds)
    .where(eq(savedEmbeds.eventId, eventId))
    .orderBy(asc(savedEmbeds.name), asc(savedEmbeds.id))
    .all();
  return rows.map(toRow);
}

export async function createSavedEmbed(
  eventId: number,
  name: string,
  widgetType: string,
  config: SavedEmbedConfig
): Promise<SavedEmbedRow | null> {
  const clean = name.trim().slice(0, 120);
  if (!clean) return null;
  const db = getDb();
  const inserted = await db
    .insert(savedEmbeds)
    .values({
      eventId,
      name: clean,
      widgetType: widgetKind(widgetType),
      configJson: JSON.stringify(config),
      enabled: true,
      createdAt: new Date(),
    })
    .returning()
    .get();
  return toRow(inserted);
}

export async function setSavedEmbedEnabled(eventId: number, id: number, enabled: boolean): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(savedEmbeds)
    .set({ enabled })
    .where(and(eq(savedEmbeds.id, id), eq(savedEmbeds.eventId, eventId)))
    .returning({ id: savedEmbeds.id })
    .all();
  return updated.length > 0;
}

export async function deleteSavedEmbed(eventId: number, id: number): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(savedEmbeds)
    .where(and(eq(savedEmbeds.id, id), eq(savedEmbeds.eventId, eventId)))
    .returning({ id: savedEmbeds.id })
    .all();
  return deleted.length > 0;
}

/** Public read for the /saved/:id route. Returns null when the row is missing or
 *  belongs to another event, which the route treats the same as disabled. */
export async function findSavedEmbed(eventId: number, id: number): Promise<SavedEmbedRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const db = getDb();
  const row = await db
    .select()
    .from(savedEmbeds)
    .where(and(eq(savedEmbeds.id, id), eq(savedEmbeds.eventId, eventId)))
    .get();
  return row ? toRow(row) : null;
}
