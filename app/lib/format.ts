// Date and CSV helpers. Dates render in the event timezone so an organizer in Lagos
// and one in Toronto read the same schedule.

export function formatDate(value: Date | null | undefined, timeZone?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(value);
}

export function formatDateTime(value: Date | null | undefined, timeZone?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(value);
}

export function formatDateRange(
  start: Date | null | undefined,
  end: Date | null | undefined,
  timeZone?: string
): string {
  if (!start && !end) return "Dates not set";
  if (start && !end) return formatDate(start, timeZone);
  if (!start && end) return formatDate(end, timeZone);
  return `${formatDate(start, timeZone)} to ${formatDate(end, timeZone)}`;
}

/** For <input type="date"> values, which are always YYYY-MM-DD. */
export function toDateInputValue(value: Date | null | undefined): string {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

export function fromDateInputValue(value: FormDataEntryValue | null): Date | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whole days until `target`, floored at 0. Used for the CFP countdown. */
export function daysUntil(target: Date | null | undefined, now = new Date()): number | null {
  if (!target) return null;
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/** Review scores: whole numbers as "4.0", fractions trimmed to "3.33" / "3.5". */
export function formatScore(value: number | null | undefined): string {
  if (value == null) return "";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** RFC 4180 quoting, plus spreadsheet formula neutralization.
 *
 *  Excel and LibreOffice evaluate a cell that opens with =, +, -, or @, so a speaker
 *  whose name or title starts with one of those turns an export into code the
 *  organizer runs by double-clicking the file. A leading apostrophe makes the cell
 *  literal text; the apostrophe itself is not shown by either program. Numbers are
 *  passed through as numbers, so score and count columns are untouched. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const neutralize = (text: string) => (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text);
  const escape = (cell: string | number | null | undefined) => {
    if (cell == null) return "";
    if (typeof cell === "number") return String(cell);
    const text = neutralize(String(cell));
    return /["\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

/** RFC 4180 reader: handles quoted fields, embedded commas, quotes, and newlines.
 *  Returns raw rows including the header row. Blank trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- Timezone math ----------
// The agenda thinks in the event's local wall clock but stores absolute instants.
// These two functions are the only conversion between the two.

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock parts of `date` as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** The instant at which `timeZone` shows this wall clock. */
export function zonedToUtc(parts: ZonedParts, timeZone: string): Date {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const seen = zonedParts(new Date(guess), timeZone);
  const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  return new Date(guess - (seenAsUtc - guess));
}

/** YYYY-MM-DD in the event timezone, the value an <input type="date"> wants. */
export function toZonedDateValue(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** HH:MM in the event timezone, the value an <input type="time"> wants. */
export function toZonedTimeValue(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function parseDayValue(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Combines a YYYY-MM-DD day and an HH:MM time into an instant in `timeZone`. */
export function zonedDayTimeToUtc(day: string, time: string, timeZone: string): Date | null {
  const parsed = parseDayValue(day);
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!parsed || !match) return null;
  return zonedToUtc({ ...parsed, hour: Number(match[1]), minute: Number(match[2]) }, timeZone);
}

/** Every calendar day the event covers, as YYYY-MM-DD in the event timezone. */
export function eventDays(start: Date | null, end: Date | null, timeZone: string): string[] {
  if (!start) return [];
  const last = end && end > start ? end : start;
  const days: string[] = [];
  // Step by UTC noon of each local day so a DST shift cannot skip or repeat one.
  let cursor = zonedParts(start, timeZone);
  const lastValue = toZonedDateValue(last, timeZone);
  for (let guard = 0; guard < 60; guard++) {
    const value = `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(cursor.day).padStart(2, "0")}`;
    days.push(value);
    if (value >= lastValue) break;
    const next = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day, 12) + 86_400_000);
    cursor = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 12, minute: 0 };
  }
  return days;
}

export function formatDayLabel(day: string, timeZone: string): string {
  const parsed = parseDayValue(day);
  if (!parsed) return day;
  const date = zonedToUtc({ ...parsed, hour: 12, minute: 0 }, timeZone);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(date);
}

export function formatTimeOfDay(value: Date | null | undefined, timeZone?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(value);
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
