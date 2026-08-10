// The attendee's personal schedule. Anonymous visitors have no account, so the
// selection lives in a cookie: it survives a reload and a new tab, it is scoped to
// one event, and it needs no sign-in. Nothing else in the app reads it.

const MAX_ITEMS = 200;
const ONE_YEAR = 60 * 60 * 24 * 365;

export function itineraryCookieName(eventId: number): string {
  return `os_itinerary_${eventId}`;
}

export function readItinerary(request: Request, eventId: number): number[] {
  const header = request.headers.get("Cookie") ?? "";
  const name = itineraryCookieName(eventId);
  const match = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return [];
  return match
    .slice(name.length + 1)
    .split("-")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, MAX_ITEMS);
}

export function itinerarySetCookie(eventId: number, ids: number[]): string {
  const value = [...new Set(ids)].slice(0, MAX_ITEMS).join("-");
  const name = itineraryCookieName(eventId);
  if (value === "") return `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  return `${name}=${value}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
}
