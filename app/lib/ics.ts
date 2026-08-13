// Minimal iCalendar builder for email attachments and portal downloads. No
// dependency: the shapes we need (VEVENTs with UTC times) fit in a few lines of
// RFC 5545.
//
// Times are always written as UTC (the trailing Z form), which is unambiguous in
// every client. The event timezone rides along as X-WR-TIMEZONE so calendars that
// honour it display the schedule in the conference's local time.

function icsEscape(text: string): string {
  // CRLF, lone LF, and lone CR all become \n. A bare carriage return left in place is
  // a line break to a permissive calendar client, which is one property injection.
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function icsDate(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export interface IcsEvent {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  end: Date;
  url?: string;
}

export type IcsMethod = "PUBLISH" | "REQUEST";

export interface IcsCalendarOptions {
  method?: IcsMethod;
  /** IANA timezone of the event, e.g. America/Los_Angeles. */
  timezone?: string | null;
  name?: string | null;
}

function vevent(event: IcsEvent): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${icsEscape(event.uid)}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(event.start)}`,
    `DTEND:${icsDate(event.end)}`,
    `SUMMARY:${icsEscape(event.title)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
  if (event.url) lines.push(`URL:${icsEscape(event.url)}`);
  lines.push("END:VEVENT");
  return lines;
}

/** One or more VEVENTs in a single calendar. METHOD:REQUEST makes mail clients
 *  treat the file as an invitation rather than a read-only feed. */
export function buildIcsCalendar(events: IcsEvent[], options: IcsCalendarOptions = {}): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenSession//EN", "CALSCALE:GREGORIAN"];
  lines.push(`METHOD:${options.method ?? "PUBLISH"}`);
  if (options.timezone) lines.push(`X-WR-TIMEZONE:${icsEscape(options.timezone)}`);
  if (options.name) lines.push(`X-WR-CALNAME:${icsEscape(options.name)}`);
  for (const event of events) lines.push(...vevent(event));
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function buildIcs(event: IcsEvent, options: IcsCalendarOptions = {}): string {
  return buildIcsCalendar([event], options);
}

export function icsResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
