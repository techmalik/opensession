// Organizer-defined fields on a contact. Values live in the contact's custom JSON,
// so adding a field never migrates a table and never touches an existing record.

import { Form, Link } from "react-router";
import type { Route } from "./+types/crm.fields";
import { requireOrganizer } from "../lib/session.server";
import { createField, deleteField, listFields } from "../lib/crm.server";
import { Card, EmptyState, ErrorNotice, Field, Notice, PageHeader, buttonPrimary, inputClass, selectClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Custom fields" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOrganizer(request);
  return { fields: await listFields() };
}

export async function action({ request }: Route.ActionArgs) {
  await requireOrganizer(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const label = String(form.get("label") ?? "").trim();
    if (!label) return { error: "Name the field.", notice: null };
    const type = String(form.get("type") ?? "text") === "select" ? "select" : "text";
    const options = String(form.get("options") ?? "")
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
    if (type === "select" && options.length === 0) {
      return { error: "A dropdown needs at least one option.", notice: null };
    }
    const result = await createField({ label, type, options });
    return result.created
      ? { error: null, notice: `Created "${label}". It now appears on every contact profile.` }
      : { error: "A field with that name already exists.", notice: null };
  }

  if (intent === "delete") {
    await deleteField(Number(form.get("fieldId") ?? 0));
    return { error: null, notice: "Field removed. Values already saved on contacts are left alone." };
  }

  return { error: null, notice: null };
}

export default function CrmFields({ loaderData, actionData }: Route.ComponentProps) {
  const { fields } = loaderData;

  return (
    <>
      <PageHeader title="Custom fields" description="Extra columns this organization tracks on every contact." />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
        <Card>
          {fields.length === 0 ? (
            <EmptyState message="No custom fields yet. Create one on the right." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {fields.map((field) => (
                <li key={field.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-slate-900">{field.label}</p>
                    <p className="text-[13px] text-slate-500">
                      {field.type === "select" ? `Dropdown: ${(JSON.parse(field.optionsJson || "[]") as string[]).join(", ")}` : "Text"}
                      <span className="ml-2 font-mono text-xs">{field.fieldKey}</span>
                    </p>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="fieldId" value={field.id} />
                    <button type="submit" name="intent" value="delete" className="text-[13px] font-medium text-slate-500 hover:text-rose-600">
                      Delete
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">New field</h2>
          <Form method="post" className="mt-3 space-y-3">
            <input type="hidden" name="intent" value="create" />
            <Field label="Label" name="label" required>
              <input id="label" name="label" placeholder="Speaker Type" className={inputClass} required />
            </Field>
            <Field label="Type" name="type">
              <select id="type" name="type" defaultValue="select" className={selectClass}>
                <option value="select">Dropdown</option>
                <option value="text">Text</option>
              </select>
            </Field>
            <Field label="Options" name="options" help="Comma separated. Dropdown only.">
              <input id="options" name="options" placeholder="Internal, External" className={inputClass} />
            </Field>
            <button type="submit" className={buttonPrimary}>
              Create field
            </button>
          </Form>
          <p className="mt-3 text-[13px] text-slate-500">
            Fields appear on every{" "}
            <Link to="/crm/contacts" className="font-medium text-accent hover:underline">
              contact profile
            </Link>{" "}
            straight away.
          </p>
        </Card>
      </div>
    </>
  );
}
