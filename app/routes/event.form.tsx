import { useState } from "react";
import { Form, Link } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/event.form";
import { getDb, appBaseUrl } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { fieldKeyFromLabel, getFields, parseConditional, type FieldDef, type FieldType } from "../lib/cfp.server";
import { fromDateInputValue, toDateInputValue } from "../lib/format";
import { events, formFields, forms } from "../../database/schema";
import {
  Badge,
  Card,
  ErrorSummary,
  Field,
  PageHeader,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
  selectSized,
  textareaClass,
} from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.form ? `${loaderData.form.name} | Form` : "Form" }];
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "select", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
  { value: "radio", label: "Radio buttons" },
  { value: "checkbox", label: "Checkbox" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
  { value: "file", label: "File upload" },
];

const TYPE_LABEL = Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t.label]));

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const formId = Number(params.formId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, slug: events.slug, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const form = await db
    .select()
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.eventId, eventId)))
    .get();
  if (!form) throw new Response("Form not found", { status: 404 });

  const fields = await getFields(formId, eventId);
  const publicUrl = `${appBaseUrl()}/submit/${event.slug}/${form.slug}`;

  return { event, form, fields, publicUrl };
}

function closesFromInput(value: FormDataEntryValue | null): Date | null {
  // A close DATE means "open through the end of that day".
  const day = fromDateInputValue(value);
  return day ? new Date(day.getTime() + 86_399_000) : null;
}

function parseOptionsInput(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function conditionalFromForm(form: FormData): string | null {
  const fieldKey = String(form.get("conditionalField") ?? "").trim();
  const value = String(form.get("conditionalValue") ?? "").trim();
  if (!fieldKey || !value) return null;
  return JSON.stringify({ fieldKey, operator: "equals", value });
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const formId = Number(params.formId);
  const db = getDb();

  const formRow = await db
    .select({ id: forms.id, status: forms.status })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.eventId, eventId)))
    .get();
  if (!formRow) throw new Response("Form not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "settings") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { error: "Enter a form name." };
    const submissionLimitRaw = String(form.get("submissionLimit") ?? "").trim();
    const maxSpeakersRaw = String(form.get("maxSpeakers") ?? "").trim();

    await db
      .update(forms)
      .set({
        name,
        welcomeHtml: String(form.get("welcomeHtml") ?? "").trim() || null,
        thankYouHtml: String(form.get("thankYouHtml") ?? "").trim() || null,
        opensAt: fromDateInputValue(form.get("opensAt")),
        closesAt: closesFromInput(form.get("closesAt")),
        submissionLimit: submissionLimitRaw ? Math.max(1, Number(submissionLimitRaw) || 1) : null,
        maxSpeakers: maxSpeakersRaw ? Math.max(1, Number(maxSpeakersRaw) || 1) : 4,
        allowDrafts: form.get("allowDrafts") === "on",
        allowEditAfterSubmit: form.get("allowEditAfterSubmit") === "on",
        confirmationSubject: String(form.get("confirmationSubject") ?? "").trim() || null,
        confirmationBody: String(form.get("confirmationBody") ?? "").trim() || null,
      })
      .where(eq(forms.id, formId));
    return { error: null, notice: "Settings saved." };
  }

  if (intent === "publish") {
    await db.update(forms).set({ status: "published" }).where(eq(forms.id, formId));
    return { error: null, notice: "Form published. The public page is live." };
  }

  if (intent === "unpublish") {
    await db.update(forms).set({ status: "draft" }).where(eq(forms.id, formId));
    return { error: null, notice: "Form reverted to draft. The public page returns 404 until you publish again." };
  }

  if (intent === "add-field") {
    const label = String(form.get("label") ?? "").trim();
    if (!label) return { error: "Enter a field label." };
    const type = String(form.get("type") ?? "text") as FieldType;
    const section = String(form.get("section") ?? "session") === "speaker" ? "speaker" : "session";

    const existing = await db
      .select({ fieldKey: formFields.fieldKey, sort: formFields.sort })
      .from(formFields)
      .where(eq(formFields.formId, formId))
      .all();
    const fieldKey = fieldKeyFromLabel(label, new Set(existing.map((f) => f.fieldKey)));
    const sort = existing.reduce((max, f) => Math.max(max, f.sort), -1) + 1;

    await db.insert(formFields).values({
      formId,
      section,
      fieldKey,
      label,
      helpText: String(form.get("helpText") ?? "").trim() || null,
      type,
      optionsJson: JSON.stringify(parseOptionsInput(String(form.get("options") ?? ""))),
      required: form.get("required") === "on",
      isSystem: false,
      sort,
      conditionalJson: conditionalFromForm(form),
    });
    return { error: null, notice: `Field "${label}" added.` };
  }

  if (intent === "update-field") {
    const id = Number(form.get("id") ?? 0);
    const row = await db
      .select()
      .from(formFields)
      .where(and(eq(formFields.id, id), eq(formFields.formId, formId)))
      .get();
    if (!row) return { error: "That field no longer exists." };

    const label = String(form.get("label") ?? "").trim();
    if (!label) return { error: "Enter a field label." };

    const lockedOptions = row.isSystem && (row.fieldKey === "track" || row.fieldKey === "format");
    await db
      .update(formFields)
      .set({
        label,
        helpText: String(form.get("helpText") ?? "").trim() || null,
        type: row.isSystem ? row.type : (String(form.get("type") ?? row.type) as FieldType),
        optionsJson: lockedOptions ? row.optionsJson : JSON.stringify(parseOptionsInput(String(form.get("options") ?? ""))),
        // The session title is the one field every submission must have.
        required: row.fieldKey === "title" ? true : form.get("required") === "on",
        conditionalJson: conditionalFromForm(form),
      })
      .where(eq(formFields.id, id));
    return { error: null, notice: `Field "${label}" saved.` };
  }

  if (intent === "delete-field") {
    const id = Number(form.get("id") ?? 0);
    const row = await db
      .select({ id: formFields.id, fieldKey: formFields.fieldKey, isSystem: formFields.isSystem })
      .from(formFields)
      .where(and(eq(formFields.id, id), eq(formFields.formId, formId)))
      .get();
    if (!row) return { error: null };
    if (row.isSystem) return { error: "System fields cannot be deleted." };

    await db.delete(formFields).where(eq(formFields.id, id));

    // Clear conditional rules that pointed at the deleted field.
    const others = await db.select().from(formFields).where(eq(formFields.formId, formId)).all();
    for (const other of others) {
      const conditional = parseConditional(other.conditionalJson);
      if (conditional?.fieldKey === row.fieldKey) {
        await db.update(formFields).set({ conditionalJson: null }).where(eq(formFields.id, other.id));
      }
    }
    return { error: null, notice: "Field deleted." };
  }

  if (intent === "move-field") {
    const id = Number(form.get("id") ?? 0);
    const direction = String(form.get("direction") ?? "up") === "down" ? 1 : -1;
    const list = await db
      .select({ id: formFields.id, sort: formFields.sort })
      .from(formFields)
      .where(eq(formFields.formId, formId))
      .orderBy(asc(formFields.sort), asc(formFields.id))
      .all();
    const index = list.findIndex((row) => row.id === id);
    const swapWith = index + direction;
    if (index === -1 || swapWith < 0 || swapWith >= list.length) return { error: null };

    const reordered = [...list];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(swapWith, 0, moved);
    for (const [position, row] of reordered.entries()) {
      await db.update(formFields).set({ sort: position }).where(eq(formFields.id, row.id));
    }
    return { error: null };
  }

  return { error: null };
}

interface ConditionalCandidate {
  fieldKey: string;
  label: string;
  options: string[];
}

function ConditionalPicker({
  candidates,
  initial,
}: {
  candidates: ConditionalCandidate[];
  initial: { fieldKey: string; value: string } | null;
}) {
  const [fieldKey, setFieldKey] = useState(initial?.fieldKey ?? "");
  const chosen = candidates.find((c) => c.fieldKey === fieldKey);

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-slate-900">Conditional visibility</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          name="conditionalField"
          value={fieldKey}
          onChange={(e) => setFieldKey(e.target.value)}
          aria-label="Show this field when"
          className={`${selectSized} w-auto min-w-44 flex-none`}
        >
          <option value="">Always shown</option>
          {candidates.map((c) => (
            <option key={c.fieldKey} value={c.fieldKey}>
              Show when {c.label}
            </option>
          ))}
        </select>
        {chosen ? (
          <>
            <span className="text-[13px] text-slate-500">equals</span>
            <select
              key={fieldKey}
              name="conditionalValue"
              defaultValue={initial?.fieldKey === fieldKey ? initial.value : ""}
              aria-label="Value that shows this field"
              className={`${selectSized} w-auto min-w-44 flex-none`}
            >
              <option value="">Choose a value</option>
              {chosen.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      <p className="text-[13px] leading-snug text-slate-500">
        Shown only when the chosen answer matches. Toggles live on the public form, no reload.
      </p>
    </div>
  );
}

function FieldEditor({
  field,
  candidates,
  intent,
  submitLabel,
}: {
  field: FieldDef | null;
  candidates: ConditionalCandidate[];
  intent: "add-field" | "update-field";
  submitLabel: string;
}) {
  const isSystem = field?.isSystem ?? false;
  const lockedOptions = isSystem && (field?.fieldKey === "track" || field?.fieldKey === "format");
  const isTitle = field?.fieldKey === "title";
  const usable = candidates.filter((c) => c.fieldKey !== field?.fieldKey);

  return (
    <Form method="post" className="space-y-4">
      {field ? <input type="hidden" name="id" value={field.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Label" name={`label-${field?.id ?? "new"}`} required>
          <input id={`label-${field?.id ?? "new"}`} name="label" defaultValue={field?.label ?? ""} className={inputClass} required />
        </Field>
        <Field label="Type" name={`type-${field?.id ?? "new"}`}>
          {isSystem ? (
            <p className="flex h-9 items-center text-sm text-slate-500">{TYPE_LABEL[field!.type]} (system field)</p>
          ) : (
            <select id={`type-${field?.id ?? "new"}`} name="type" defaultValue={field?.type ?? "text"} className={selectClass}>
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {!field ? (
        <Field label="Section" name="section-new" help="Session fields describe the talk. Speaker fields go on the speaker step.">
          <select id="section-new" name="section" defaultValue="session" className={selectClass}>
            <option value="session">Session</option>
            <option value="speaker">Speaker</option>
          </select>
        </Field>
      ) : null}

      <Field label="Help text" name={`help-${field?.id ?? "new"}`}>
        <input id={`help-${field?.id ?? "new"}`} name="helpText" defaultValue={field?.helpText ?? ""} className={inputClass} />
      </Field>

      <Field
        label="Options"
        name={`options-${field?.id ?? "new"}`}
        help={
          lockedOptions
            ? "Options come from Settings, Tracks and formats."
            : "One per line. Used by dropdown, multi-select, and radio fields."
        }
      >
        <textarea
          id={`options-${field?.id ?? "new"}`}
          name="options"
          rows={3}
          defaultValue={field?.options.join("\n") ?? ""}
          disabled={lockedOptions}
          className={`${textareaClass} disabled:bg-slate-50 disabled:text-slate-500`}
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-slate-900">
        <input
          type="checkbox"
          name="required"
          defaultChecked={field?.required ?? false}
          disabled={isTitle}
          className="accent-accent"
        />
        Required
        {isTitle ? <span className="text-[13px] text-slate-500">(the title is always required)</span> : null}
      </label>

      <ConditionalPicker
        candidates={usable}
        initial={field?.conditional ? { fieldKey: field.conditional.fieldKey, value: field.conditional.value } : null}
      />

      <button type="submit" name="intent" value={intent} className={buttonSecondary}>
        {submitLabel}
      </button>
    </Form>
  );
}

export default function FormEditor({ loaderData, actionData, params }: Route.ComponentProps) {
  const { form, fields, publicUrl } = loaderData;
  const [copied, setCopied] = useState(false);

  const candidates: ConditionalCandidate[] = fields
    .filter((f) => (f.type === "select" || f.type === "radio" || f.type === "multiselect") && f.options.length > 0)
    .map((f) => ({ fieldKey: f.fieldKey, label: f.label, options: f.options }));

  const errors: Record<string, string> = actionData?.error ? { form: actionData.error } : {};

  return (
    <>
      <div className="mb-2 text-[13px]">
        <Link to={`/admin/${params.eventId}/forms`} className="text-slate-500 hover:text-slate-900">
          Forms
        </Link>
        <span className="mx-1 text-slate-400">/</span>
        <span className="text-slate-900">{form.name}</span>
      </div>

      <PageHeader
        title={form.name}
        description={
          form.status === "published"
            ? "Published. Changes here go live immediately."
            : form.status === "closed"
              ? "Closed. The public page rejects new submissions."
              : "Draft. The public page returns 404 until you publish."
        }
        actions={
          <>
            {form.status === "published" ? (
              <>
                <a href={publicUrl} target="_blank" rel="noreferrer" className={buttonSecondary}>
                  View public form
                </a>
                <Form method="post">
                  <button type="submit" name="intent" value="unpublish" className={buttonGhost}>
                    Revert to draft
                  </button>
                </Form>
              </>
            ) : (
              <Form method="post">
                <button type="submit" name="intent" value="publish" className={buttonPrimary}>
                  Publish form
                </button>
              </Form>
            )}
          </>
        }
      />

      <ErrorSummary errors={errors} />
      {actionData && "notice" in actionData && actionData.notice ? (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{actionData.notice}</div>
      ) : null}

      <div className="grid max-w-[900px] gap-4">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Public link</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-slate-100 px-2 py-1.5 font-mono text-[13px] text-slate-900">{publicUrl}</code>
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => {
                navigator.clipboard.writeText(publicUrl).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          {form.status !== "published" ? (
            <p className="mt-2 text-[13px] text-slate-500">The link goes live when the form is published.</p>
          ) : null}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Settings</h2>
          <Form method="post" className="mt-4 space-y-4">
            <Field label="Form name" name="name" required>
              <input id="name" name="name" defaultValue={form.name} className={inputClass} required />
            </Field>

            <Field label="Welcome text" name="welcomeHtml" help="Shown at the top of the public form. Basic HTML allowed.">
              <textarea id="welcomeHtml" name="welcomeHtml" rows={3} defaultValue={form.welcomeHtml ?? ""} className={textareaClass} />
            </Field>

            <Field label="Thank-you text" name="thankYouHtml" help="Shown on the confirmation screen after submitting.">
              <textarea id="thankYouHtml" name="thankYouHtml" rows={2} defaultValue={form.thankYouHtml ?? ""} className={textareaClass} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Opens" name="opensAt" help="Empty means open as soon as the form is published.">
                <input id="opensAt" name="opensAt" type="date" defaultValue={toDateInputValue(form.opensAt)} className={inputClass} />
              </Field>
              <Field label="Closes" name="closesAt" help="Submissions and edits stop at the end of this day.">
                <input id="closesAt" name="closesAt" type="date" defaultValue={toDateInputValue(form.closesAt)} className={inputClass} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Submission limit" name="submissionLimit" help="Max submissions per person. Empty means no limit.">
                <input
                  id="submissionLimit"
                  name="submissionLimit"
                  type="number"
                  min={1}
                  defaultValue={form.submissionLimit ?? ""}
                  className={inputClass}
                />
              </Field>
              <Field label="Max speakers" name="maxSpeakers" help="Including co-speakers.">
                <input id="maxSpeakers" name="maxSpeakers" type="number" min={1} defaultValue={form.maxSpeakers} className={inputClass} />
              </Field>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-900">
                <input type="checkbox" name="allowDrafts" defaultChecked={form.allowDrafts} className="accent-accent" />
                Allow saving drafts
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-900">
                <input type="checkbox" name="allowEditAfterSubmit" defaultChecked={form.allowEditAfterSubmit} className="accent-accent" />
                Allow editing after submitting, until the form closes
              </label>
            </div>

            <Field label="Confirmation email subject" name="confirmationSubject">
              <input id="confirmationSubject" name="confirmationSubject" defaultValue={form.confirmationSubject ?? ""} className={inputClass} />
            </Field>
            <Field
              label="Confirmation email body"
              name="confirmationBody"
              help="Merge tags: {speaker_name}, {talk_title}, {event_name}, {portal_url}."
            >
              <textarea id="confirmationBody" name="confirmationBody" rows={4} defaultValue={form.confirmationBody ?? ""} className={textareaClass} />
            </Field>

            <button type="submit" name="intent" value="settings" className={buttonPrimary}>
              Save settings
            </button>
          </Form>
        </Card>

        <Card>
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Fields</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">
              The public form renders these in order: session fields first, then the speaker step.
            </p>
          </div>

          <ul className="divide-y divide-slate-100">
            {fields.map((field, index) => (
              <li key={field.id} className="px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">
                      {field.label}
                      {field.required ? <span className="ml-0.5 text-slate-500">*</span> : null}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-500">
                      <Badge>{TYPE_LABEL[field.type]}</Badge>
                      <Badge>{field.section === "speaker" ? "Speaker" : "Session"}</Badge>
                      {field.isSystem ? <Badge>System</Badge> : null}
                      {field.conditional ? (
                        <span>
                          Shows when {fields.find((f) => f.fieldKey === field.conditional!.fieldKey)?.label ?? field.conditional.fieldKey} ={" "}
                          {field.conditional.value}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <Form method="post">
                    <input type="hidden" name="id" value={field.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button type="submit" name="intent" value="move-field" className={buttonGhost} disabled={index === 0} aria-label={`Move ${field.label} up`}>
                      Up
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="id" value={field.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      type="submit"
                      name="intent"
                      value="move-field"
                      className={buttonGhost}
                      disabled={index === fields.length - 1}
                      aria-label={`Move ${field.label} down`}
                    >
                      Down
                    </button>
                  </Form>
                  {!field.isSystem ? (
                    <Form method="post" onSubmit={(e) => !confirm(`Delete the field "${field.label}"?`) && e.preventDefault()}>
                      <input type="hidden" name="id" value={field.id} />
                      <button type="submit" name="intent" value="delete-field" className={buttonGhost} aria-label={`Delete ${field.label}`}>
                        Delete
                      </button>
                    </Form>
                  ) : null}
                </div>

                <details className="mt-1">
                  <summary className="cursor-pointer text-[13px] font-medium text-accent">Edit field</summary>
                  <div className="mt-3 border-l-2 border-slate-100 pl-4">
                    <FieldEditor field={field} candidates={candidates} intent="update-field" submitLabel="Save field" />
                  </div>
                </details>
              </li>
            ))}
          </ul>

          <div className="border-t border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Add a field</h3>
            <div className="mt-3">
              <FieldEditor field={null} candidates={candidates} intent="add-field" submitLabel="Add field" />
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
