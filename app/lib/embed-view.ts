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
