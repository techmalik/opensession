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

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** RFC 4180 quoting: a field containing a quote, comma, or newline is quoted. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (cell: string | number | null | undefined) => {
    const text = cell == null ? "" : String(cell);
    return /["\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
