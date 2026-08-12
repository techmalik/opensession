// Add one speaker by hand. An existing contact with the same email is reused rather
// than duplicated: the same person often speaks at more than one event.

import { Form, Link, redirect } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.speaker.new";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { contacts, eventContacts, events } from "../../database/schema";
import { Breadcrumbs, Card, ErrorNotice, Field, PageHeader, buttonPrimary, buttonSecondary, inputClass, selectClass, textareaClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Add speaker" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });
  return { event };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const form = await request.formData();

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const firstName = String(form.get("firstName") ?? "").trim();
  const lastName = String(form.get("lastName") ?? "").trim();
  if (!email || !email.includes("@")) return { error: "Enter a valid email address." };
  if (!firstName) return { error: "Enter a first name." };

  const values = {
    firstName,
    lastName,
    title: String(form.get("title") ?? "").trim() || null,
    company: String(form.get("company") ?? "").trim() || null,
    bio: String(form.get("bio") ?? "").trim() || null,
    twitter: String(form.get("twitter") ?? "").trim() || null,
    linkedin: String(form.get("linkedin") ?? "").trim() || null,
    dietary: String(form.get("dietary") ?? "").trim() || null,
    tshirt: String(form.get("tshirt") ?? "").trim() || null,
    travel: String(form.get("travel") ?? "").trim() || null,
    updatedAt: new Date(),
  };

  const existing = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email)).get();
  let contactId: number;
  if (existing) {
    await db.update(contacts).set(values).where(eq(contacts.id, existing.id));
    contactId = existing.id;
  } else {
    const created = await db
      .insert(contacts)
      .values({ email, ...values, createdAt: new Date() })
      .returning({ id: contacts.id })
      .get();
    contactId = created.id;
  }

  const status = String(form.get("status") ?? "invited");
  await db
    .insert(eventContacts)
    .values({
      eventId,
      contactId,
      kind: "speaker",
      status: status === "confirmed" || status === "declined" ? status : "invited",
    })
    .onConflictDoUpdate({
      target: [eventContacts.eventId, eventContacts.contactId],
      set: { kind: "speaker" },
    });

  throw redirect(`/admin/${params.eventId}/speakers/${contactId}`);
}

export default function NewSpeaker({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event } = loaderData;
  const base = `/admin/${params.eventId}`;

  return (
    <>
      <Breadcrumbs items={[{ to: `${base}/speakers`, label: "Speakers" }, { label: "Add speaker" }]} />

      <PageHeader title="Add speaker" description={`Add someone to the ${event.name} roster.`} />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}

      <Card className="max-w-[640px] p-4">
        <Form method="post" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="First name" name="firstName" required>
              <input id="firstName" name="firstName" className={inputClass} required />
            </Field>
            <Field label="Last name" name="lastName">
              <input id="lastName" name="lastName" className={inputClass} />
            </Field>
          </div>

          <Field label="Email" name="email" required help="Also the address their speaker portal signs in with.">
            <input id="email" name="email" type="email" className={inputClass} required />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Job title" name="title">
              <input id="title" name="title" className={inputClass} />
            </Field>
            <Field label="Company" name="company">
              <input id="company" name="company" className={inputClass} />
            </Field>
          </div>

          <Field label="Bio" name="bio">
            <textarea id="bio" name="bio" rows={5} className={textareaClass} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Twitter" name="twitter">
              <input id="twitter" name="twitter" className={inputClass} />
            </Field>
            <Field label="LinkedIn" name="linkedin">
              <input id="linkedin" name="linkedin" className={inputClass} />
            </Field>
          </div>

          <Field label="Status" name="status">
            <select id="status" name="status" defaultValue="invited" className={selectClass}>
              <option value="invited">Invited</option>
              <option value="confirmed">Confirmed</option>
              <option value="declined">Declined</option>
            </select>
          </Field>

          <div className="flex items-center gap-2">
            <button type="submit" className={buttonPrimary}>
              Add speaker
            </button>
            <Link to={`${base}/speakers`} className={buttonSecondary}>
              Cancel
            </Link>
          </div>
        </Form>
      </Card>
    </>
  );
}
