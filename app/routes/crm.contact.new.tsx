// Manual contact entry. Duplicate names are allowed on purpose: two people really
// can share a name, and the duplicates screen is where a merge decision belongs.

import { Form, Link, redirect } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/crm.contact.new";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { contacts } from "../../database/schema";
import { Breadcrumbs, Card, ErrorNotice, Field, PageHeader, buttonPrimary, buttonSecondary, inputClass, textareaClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Add contact" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOrganizer(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  await requireOrganizer(request);
  const form = await request.formData();
  const db = getDb();

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const firstName = String(form.get("firstName") ?? "").trim();
  const lastName = String(form.get("lastName") ?? "").trim();
  if (!email.includes("@")) return { error: "Enter a valid email address." };
  if (!firstName && !lastName) return { error: "Enter a name." };

  const existing = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email)).get();
  if (existing) return { error: "A contact with that email already exists." };

  const now = new Date();
  const created = await db
    .insert(contacts)
    .values({
      email,
      firstName,
      lastName,
      title: String(form.get("title") ?? "").trim() || null,
      company: String(form.get("company") ?? "").trim() || null,
      bio: String(form.get("bio") ?? "").trim() || null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: contacts.id })
    .get();

  throw redirect(`/crm/contacts/${created.id}`);
}

export default function CrmNewContact({ actionData }: Route.ComponentProps) {
  return (
    <>
      <Breadcrumbs items={[{ to: "/crm/contacts", label: "Directory" }, { label: "Add contact" }]} />

      <PageHeader title="Add contact" description="Goes into the org database, not onto any event until you push it." />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}

      <div className="max-w-[640px]">
        <Card className="p-4">
          <Form method="post" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Field label="First name" name="firstName">
                <input id="firstName" name="firstName" className={inputClass} />
              </Field>
              <Field label="Last name" name="lastName">
                <input id="lastName" name="lastName" className={inputClass} />
              </Field>
            </div>
            <Field label="Email" name="email" required>
              <input id="email" name="email" type="email" className={inputClass} required />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <Field label="Job title" name="title">
                <input id="title" name="title" className={inputClass} />
              </Field>
              <Field label="Company" name="company">
                <input id="company" name="company" className={inputClass} />
              </Field>
            </div>
            <Field label="Bio" name="bio">
              <textarea id="bio" name="bio" rows={4} className={textareaClass} />
            </Field>
            <div className="flex items-center gap-2">
              <button type="submit" className={buttonPrimary}>
                Add contact
              </button>
              <Link to="/crm/contacts" className={buttonSecondary}>
                Cancel
              </Link>
            </div>
          </Form>
        </Card>
      </div>
    </>
  );
}
