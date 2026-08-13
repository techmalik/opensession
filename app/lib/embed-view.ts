// Client-safe shapes and constants for the public widgets. Route components and
// app/components/embed.tsx bundle this file, so it must never import a .server
// module. app/lib/public.server.ts builds these shapes and re-exports the types.

export interface PublicEvent {
  id: number;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  location: string | null;
  timezone: string;
  dateRange: string;
  agendaPublished: boolean;
}

export interface PublicSpeaker {
  contactId: number;
  name: string;
  sortKey: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  initials: string;
  headshotUrl: string | null;
  role: string;
}

export interface PublicSession {
  id: number;
  friendlyId: string;
  title: string;
  abstract: string;
  trackName: string | null;
  trackColor: string | null;
  formatName: string | null;
  roomId: number | null;
  roomName: string | null;
  day: string;
  dayLabel: string;
  startLabel: string;
  endLabel: string;
  whenLabel: string;
  startIso: string;
  endIso: string;
  startMinutes: number;
  durationMin: number;
  speakers: PublicSpeaker[];
  tags: string[];
}

export interface PublicSpeakerProfile extends PublicSpeaker {
  sessions: PublicSession[];
}

export type WidgetKind = "sessions" | "speakers" | "agenda" | "itinerary" | "gallery";

export const WIDGETS: { kind: WidgetKind; label: string; description: string }[] = [
  { kind: "sessions", label: "Sessions", description: "Searchable list of every published session with filters and detail." },
  { kind: "speakers", label: "Speakers", description: "Speaker directory with bios and the sessions each person is on." },
  { kind: "agenda", label: "Agenda", description: "Room by time grid for one day, with day navigation." },
  { kind: "itinerary", label: "Itinerary", description: "Chronological day by day list with a personal schedule." },
  { kind: "gallery", label: "Gallery", description: "Photo grid of speakers with a detail panel." },
];

export function embedPath(slug: string, kind: WidgetKind): string {
  return `/embed/v1/${slug}/${kind}`;
}

/** Cards truncate to this many characters before the Show more control. */
export const SNIPPET_CHARS = 180;

export function snippet(text: string, chars = SNIPPET_CHARS): { short: string; truncated: boolean } {
  const clean = text.trim();
  if (clean.length <= chars) return { short: clean, truncated: false };
  const cut = clean.slice(0, chars);
  const lastSpace = cut.lastIndexOf(" ");
  return { short: `${cut.slice(0, lastSpace > 60 ? lastSpace : chars).trimEnd()}...`, truncated: true };
}

// ---------- Branding (EMB-15) ----------
// Two knobs, both read from the query string and applied server-side, because the
// widgets carry no JavaScript. A URL with neither param renders exactly what it
// rendered before this existed.

/** app.css --color-accent / --color-accent-hover. Kept in step by hand: this file
 *  is client-safe and cannot read the stylesheet. */
export const DEFAULT_ACCENT = "#0b7b57";
export const DEFAULT_ACCENT_HOVER = "#096646";

export interface EmbedBranding {
  accent: string;
  accentHover: string;
  header: boolean;
}

export const DEFAULT_BRANDING: EmbedBranding = {
  accent: DEFAULT_ACCENT,
  accentHover: DEFAULT_ACCENT_HOVER,
  header: true,
};

/** Accepts "#0b7b57", "0b7b57", "#abc". Anything else is null, and the caller falls
 *  back to the default rather than writing an attacker-chosen string into a style. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((char) => char + char).join("") : raw;
  return /^[0-9a-f]{6}$/i.test(full) ? `#${full.toLowerCase()}` : null;
}

/** Hover shade: the accent mixed toward black. The default pair sits at roughly this
 *  ratio, so a custom accent gets a hover that behaves the same way. */
export function darkenHex(hex: string, factor = 0.82): string {
  const value = normalizeHex(hex) ?? DEFAULT_ACCENT;
  const channels = [1, 3, 5].map((start) => {
    const scaled = Math.round(parseInt(value.slice(start, start + 2), 16) * factor);
    return Math.max(0, Math.min(255, scaled)).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

export function readBranding(params: URLSearchParams): EmbedBranding {
  const accent = normalizeHex(params.get("accent"));
  return {
    accent: accent ?? DEFAULT_ACCENT,
    accentHover: accent ? darkenHex(accent) : DEFAULT_ACCENT_HOVER,
    // header=0 hides the widget's own title bar for sites that already have one.
    header: params.get("header") !== "0",
  };
}

export function isDefaultBranding(branding: EmbedBranding): boolean {
  return branding.accent === DEFAULT_ACCENT && branding.header;
}

/** Query pairs for a snippet URL. Empty when nothing was customised, so a default
 *  snippet stays the URL it has always been. */
export function brandingParams(branding: EmbedBranding): [string, string][] {
  const pairs: [string, string][] = [];
  if (branding.accent !== DEFAULT_ACCENT) pairs.push(["accent", branding.accent]);
  if (!branding.header) pairs.push(["header", "0"]);
  return pairs;
}
