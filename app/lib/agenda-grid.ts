// Grid geometry for the agenda, shared by the builder component and the server-side
// scheduler. Client-safe on purpose: no .server imports here.

/** The grid window, in the event's local time. 15-minute rows. */
export const AGENDA_START_HOUR = 8;
export const AGENDA_END_HOUR = 20;
export const SLOT_MINUTES = 15;
export const DEFAULT_DURATION_MIN = 30;

/** Minute offsets of every row in the grid, from AGENDA_START_HOUR. */
export function slotOffsets(): number[] {
  const total = (AGENDA_END_HOUR - AGENDA_START_HOUR) * 60;
  return Array.from({ length: total / SLOT_MINUTES }, (_, index) => index * SLOT_MINUTES);
}

export function slotLabel(offsetMinutes: number): string {
  const minutes = AGENDA_START_HOUR * 60 + offsetMinutes;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function slotTimeValue(offsetMinutes: number): string {
  const minutes = AGENDA_START_HOUR * 60 + offsetMinutes;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "10:00" back to a grid offset, for labelling a proposal row. */
export function offsetForTimeValue(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0) - AGENDA_START_HOUR * 60;
}
