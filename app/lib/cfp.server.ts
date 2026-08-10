// Form and submission helpers shared by the builder, the public portal, the speaker
// portal, and the organizer views. One definition of "what fields does this form
// have", "is it open", and "which answers are valid" for all of them.

import { and, asc, eq, like } from "drizzle-orm";
import { getDb } from "./db.server";
import { events, formFields, formats, forms, sessions, statuses, tracks } from "../../database/schema";

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "multiselect"
  | "checkbox"
  | "radio"
  | "number"
  | "date"
  | "email"
  | "url"
  | "file";

export interface FieldConditional {
  fieldKey: string;
  operator: "equals";
  value: string;
}

export interface FieldDef {
  id: number;
  section: "session" | "speaker";
  fieldKey: string;
  label: string;
  helpText: string | null;
  type: FieldType;
  options: string[];
  required: boolean;
  isSystem: boolean;
  sort: number;
  conditional: FieldConditional | null;
}

export function parseConditional(raw: string | null): FieldConditional | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FieldConditional;
    if (parsed && typeof parsed.fieldKey === "string" && typeof parsed.value === "string") {
      return { fieldKey: parsed.fieldKey, operator: "equals", value: parsed.value };
    }
  } catch {
    // fall through
  }
  return null;
}

function parseOptions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Fields for a form, ordered. System track/format fields always reflect the live
 *  taxonomy, so renaming a track updates the public form without editing the field. */
export async function getFields(formId: number, eventId: number): Promise<FieldDef[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(formFields)
    .where(eq(formFields.formId, formId))
    .orderBy(asc(formFields.sort), asc(formFields.id))
    .all();

  const trackNames = (
    await db.select({ name: tracks.name }).from(tracks).where(eq(tracks.eventId, eventId)).orderBy(asc(tracks.sort), asc(tracks.id)).all()
  ).map((t) => t.name);
  const formatNames = (
    await db.select({ name: formats.name }).from(formats).where(eq(formats.eventId, eventId)).orderBy(asc(formats.sort), asc(formats.id)).all()
  ).map((f) => f.name);

  return rows.map((row) => ({
    id: row.id,
    section: row.section,
    fieldKey: row.fieldKey,
    label: row.label,
    helpText: row.helpText,
    type: row.type,
    options:
      row.isSystem && row.fieldKey === "track"
        ? trackNames
        : row.isSystem && row.fieldKey === "format"
          ? formatNames
          : parseOptions(row.optionsJson),
    required: row.required,
    isSystem: row.isSystem,
    sort: row.sort,
    conditional: parseConditional(row.conditionalJson),
  }));
}

export type FormOpenState = "open" | "closed" | "not_open";

export function formOpenState(
  form: { status: string; opensAt: Date | null; closesAt: Date | null },
  now = new Date()
): FormOpenState {
  if (form.status === "closed") return "closed";
  if (form.closesAt && form.closesAt <= now) return "closed";
  if (form.opensAt && form.opensAt > now) return "not_open";
  return "open";
}

/** A conditional field only exists when its controlling answer matches. Hidden
 *  fields are not required and their answers are dropped server-side. */
export function visibleFields(fields: FieldDef[], answers: Record<string, string>): FieldDef[] {
  return fields.filter((field) => {
    if (!field.conditional) return true;
    return (answers[field.conditional.fieldKey] ?? "") === field.conditional.value;
  });
}

/** Server-side mirror of the required flags. `fields` should already be filtered to
 *  the visible set for these answers. */
export function validateRequired(fields: FieldDef[], answers: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!field.required) continue;
    const value = (answers[field.fieldKey] ?? "").trim();
    if (!value) {
      errors[field.fieldKey] =
        field.type === "select" || field.type === "radio" || field.type === "multiselect"
          ? `Choose ${field.label.toLowerCase()}.`
          : `Enter ${field.label.toLowerCase()}.`;
    }
  }
  return errors;
}

/** Sessions created outside the form flow (seed data, manual entry, API) keep their
 *  core answers in columns, not answers_json. Fill the gaps so detail views never
 *  show an empty title/abstract/track/format for a populated session. */
export function withColumnFallbacks(
  answers: Record<string, string>,
  session: { title: string; abstract: string | null },
  names: { track?: string | null; format?: string | null; level?: string | null }
): Record<string, string> {
  const merged = { ...answers };
  if (!merged.title?.trim()) merged.title = session.title;
  if (!merged.abstract?.trim() && session.abstract) merged.abstract = session.abstract;
  if (!merged.track?.trim() && names.track) merged.track = names.track;
  if (!merged.format?.trim() && names.format) merged.format = names.format;
  if (!merged.audience_level?.trim() && names.level) merged.audience_level = names.level;
  return merged;
}

/** SESS-1001, SESS-1002, ... globally unique (friendly_id has a unique index). */
export async function nextFriendlyId(): Promise<string> {
  const db = getDb();
  const rows = await db.select({ friendlyId: sessions.friendlyId }).from(sessions).where(like(sessions.friendlyId, "SESS-%")).all();
  let max = 1000;
  for (const row of rows) {
    const n = Number(row.friendlyId.slice(5));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `SESS-${max + 1}`;
}

/** What a speaker sees. Queue statuses stay internal until the decision is recorded:
 *  the speaker-facing label is Under review until Accepted or Declined. */
export function speakerStatus(statusKey: string | null | undefined, isDraft: boolean): { key: string; label: string } {
  if (isDraft) return { key: "draft", label: "Draft" };
  if (statusKey === "accepted") return { key: "accepted", label: "Accepted" };
  if (statusKey === "declined") return { key: "declined", label: "Declined" };
  return { key: "pending", label: "Under review" };
}

export async function getStatusByKey(eventId: number, key: string) {
  const db = getDb();
  return db
    .select({ id: statuses.id, key: statuses.key, label: statuses.label })
    .from(statuses)
    .where(and(eq(statuses.eventId, eventId), eq(statuses.key, key)))
    .get();
}

export async function loadPublicForm(eventSlug: string, formSlug: string) {
  const db = getDb();
  const event = await db
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      tagline: events.tagline,
      location: events.location,
      timezone: events.timezone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
    })
    .from(events)
    .where(and(eq(events.slug, eventSlug), eq(events.status, "active")))
    .get();
  if (!event) return null;

  const form = await db
    .select()
    .from(forms)
    .where(and(eq(forms.eventId, event.id), eq(forms.slug, formSlug)))
    .get();
  if (!form || form.status === "draft") return null;

  return { event, form };
}

/** The baseline system fields every new form starts with. Track and format options
 *  come from the live taxonomy at render time; the stored JSON is a fallback. */
export async function createBaselineFields(formId: number, eventId: number): Promise<void> {
  const db = getDb();
  const trackNames = (
    await db.select({ name: tracks.name }).from(tracks).where(eq(tracks.eventId, eventId)).orderBy(asc(tracks.sort)).all()
  ).map((t) => t.name);
  const formatNames = (
    await db.select({ name: formats.name }).from(formats).where(eq(formats.eventId, eventId)).orderBy(asc(formats.sort)).all()
  ).map((f) => f.name);

  const baseline: Array<{
    section: "session" | "speaker";
    fieldKey: string;
    label: string;
    type: FieldType;
    options: string[];
    required: boolean;
  }> = [
    { section: "session", fieldKey: "title", label: "Session title", type: "text", options: [], required: true },
    { section: "session", fieldKey: "abstract", label: "Abstract", type: "textarea", options: [], required: true },
    { section: "session", fieldKey: "track", label: "Track", type: "select", options: trackNames, required: true },
    { section: "session", fieldKey: "format", label: "Session format", type: "select", options: formatNames, required: true },
    { section: "speaker", fieldKey: "bio", label: "Speaker bio", type: "textarea", options: [], required: true },
    { section: "speaker", fieldKey: "company", label: "Company", type: "text", options: [], required: false },
  ];

  await db.insert(formFields).values(
    baseline.map((field, index) => ({
      formId,
      section: field.section,
      fieldKey: field.fieldKey,
      label: field.label,
      type: field.type,
      optionsJson: JSON.stringify(field.options),
      required: field.required,
      isSystem: true,
      sort: index,
    }))
  );
}

/** A stable snake_case key from a label, unique within the form. */
export function fieldKeyFromLabel(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}_${n}`;
  return candidate;
}
