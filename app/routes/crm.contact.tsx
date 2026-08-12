// One contact, everything the org knows: identity, tags, custom fields, internal
// notes, every event and session they have been part of, and an activity feed that
// merges notes, mail, and pipeline moves.

import { Form, Link } from "react-router";
import type { Route } from "./+types/crm.contact";
import { eq } from "drizzle-orm";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import {
  addContactsToEvent,
  addNote,
  contactActivity,
  contactConnections,
  getContact,
  listEventsForPicker,
  listFields,
  listNotes,
  setCustomValues,
  setTags,
} from "../lib/crm.server";
import { enrollProspect } from "../lib/crm.server";
import { CRM_STAGES } from "../lib/crm-view";
import { formatDateTime } from "../lib/format";
import { contacts, crmProspects, fileUploads } from "../../database/schema";
import {
  Breadcrumbs,
  Card,
  ErrorNotice,
  Field,
  Notice,
  PageHeader,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
  selectSized,
  textareaClass,
} from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.contact ? loaderData.contact.name : "Contact" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const contactId = Number(params.contactId);
  const contact = await getContact(contactId);
  if (!contact) throw new Response("Contact not found", { status: 404 });

  const db = getDb();
  const headshot = contact.headshotBlobKey
    ? await db.select({ id: fileUploads.id }).from(fileUploads).where(eq(fileUploads.blobKey, contact.headshotBlobKey)).get()
    : null;
  const prospect = await db.select({ id: crmProspects.id, stage: crmProspects.stage }).from(crmProspects).where(eq(crmProspects.contactId, contactId)).get();

  return {
    contact: {
      id: contact.id,
      name: contact.name,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      title: contact.title,
      company: contact.company,
      bio: contact.bio,
      phone: contact.phone,
      twitter: contact.twitter,
      linkedin: contact.linkedin,
      website: contact.website,
      tags: contact.tags,
      custom: contact.custom,
      createdAt: contact.createdAt,
    },
    headshotUploadId: headshot?.id ?? null,
    notes: await listNotes(contactId),
    connections: await contactConnections(contactId),
    activity: await contactActivity(contactId),
    fields: await listFields(),
    events: await listEventsForPicker(),
    stages: CRM_STAGES,
    prospect: prospect ?? null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const contactId = Number(params.contactId);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-profile") {
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!email.includes("@")) return { error: "Enter a valid email address.", notice: null };
    await db
      .update(contacts)
      .set({
        firstName: String(form.get("firstName") ?? "").trim(),
        lastName: String(form.get("lastName") ?? "").trim(),
        email,
        title: String(form.get("title") ?? "").trim() || null,
        company: String(form.get("company") ?? "").trim() || null,
        bio: String(form.get("bio") ?? "").trim() || null,
        phone: String(form.get("phone") ?? "").trim() || null,
        linkedin: String(form.get("linkedin") ?? "").trim() || null,
        website: String(form.get("website") ?? "").trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId));
    return { error: null, notice: "Profile saved." };
  }

  if (intent === "add-note") {
    const body = String(form.get("body") ?? "").trim();
    if (!body) return { error: "Write the note first.", notice: null };
    await addNote(contactId, body, { id: user.id, name: user.name });
    return { error: null, notice: "Note added." };
  }

  if (intent === "save-tags") {
    await setTags(contactId, String(form.get("tags") ?? "").split(","));
    return { error: null, notice: "Tags saved." };
  }

  if (intent === "save-custom") {
    const fields = await listFields();
    const values: Record<string, string> = {};
    for (const field of fields) values[field.fieldKey] = String(form.get(`custom_${field.fieldKey}`) ?? "").trim();
    await setCustomValues(contactId, values);
    return { error: null, notice: "Custom fields saved." };
  }

  if (intent === "add-to-event") {
    const eventId = Number(form.get("eventId") ?? 0);
    if (!eventId) return { error: "Choose an event.", notice: null };
    const added = await addContactsToEvent(eventId, [contactId]);
    const events = await listEventsForPicker();
    const name = events.find((row) => row.id === eventId)?.name ?? "the event";
    return {
      error: null,
      notice: added === 0 ? `Already on ${name}.` : `Added to ${name} with the existing profile, nothing re-entered.`,
    };
  }

  if (intent === "enroll") {
    await enrollProspect({
      contactId,
      stage: "identified",
      score: null,
      rationale: "",
      eventId: null,
      author: { id: user.id, name: user.name },
    });
    return { error: null, notice: "Enrolled in the sourcing pipeline." };
  }

  return { error: null, notice: null };
}

export default function CrmContact({ loaderData, actionData }: Route.ComponentProps) {
  const { contact, headshotUploadId, notes, connections, activity, fields, events, prospect } = loaderData;

  return (
    <>
      <Breadcrumbs items={[{ to: "/crm/contacts", label: "Directory" }, { label: contact.name }]} />

      <PageHeader
        title={contact.name}
        description={[contact.title, contact.company].filter(Boolean).join(", ") || contact.email}
        actions={
          prospect ? (
            <Link to="/crm/pipeline" className={buttonSecondary}>
              In pipeline, {prospect.stage}
            </Link>
          ) : (
            <Form method="post">
              <button type="submit" name="intent" value="enroll" className={buttonSecondary}>
                Add to pipeline
              </button>
            </Form>
          )
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-start gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100">
                {headshotUploadId ? (
                  <img src={`/files/${headshotUploadId}?inline=1`} alt={`Headshot of ${contact.name}`} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-lg font-medium text-slate-500">
                    {(contact.firstName[0] ?? "") + (contact.lastName[0] ?? "")}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-slate-900">Profile</h2>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  The same record every event reads. Editing here updates it everywhere.
                </p>
              </div>
            </div>

            <Form method="post" className="mt-4 space-y-3">
              <input type="hidden" name="intent" value="save-profile" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name" name="firstName">
                  <input id="firstName" name="firstName" defaultValue={contact.firstName} className={inputClass} />
                </Field>
                <Field label="Last name" name="lastName">
                  <input id="lastName" name="lastName" defaultValue={contact.lastName} className={inputClass} />
                </Field>
              </div>
              <Field label="Email" name="email" required>
                <input id="email" name="email" type="email" defaultValue={contact.email} className={inputClass} required />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Job title" name="title">
                  <input id="title" name="title" defaultValue={contact.title ?? ""} className={inputClass} />
                </Field>
                <Field label="Company" name="company">
                  <input id="company" name="company" defaultValue={contact.company ?? ""} className={inputClass} />
                </Field>
              </div>
              <Field label="Bio" name="bio">
                <textarea id="bio" name="bio" rows={4} defaultValue={contact.bio ?? ""} className={textareaClass} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Phone" name="phone">
                  <input id="phone" name="phone" defaultValue={contact.phone ?? ""} className={inputClass} />
                </Field>
                <Field label="LinkedIn" name="linkedin">
                  <input id="linkedin" name="linkedin" defaultValue={contact.linkedin ?? ""} className={inputClass} />
                </Field>
                <Field label="Website" name="website">
                  <input id="website" name="website" defaultValue={contact.website ?? ""} className={inputClass} />
                </Field>
              </div>
              <button type="submit" className={buttonPrimary}>
                Save profile
              </button>
            </Form>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Internal notes</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">Only organizers see these. Speakers never do.</p>
            <Form method="post" className="mt-3 space-y-2">
              <input type="hidden" name="intent" value="add-note" />
              <label htmlFor="body" className="sr-only">
                Note
              </label>
              <textarea id="body" name="body" rows={3} placeholder="What should the team know about this person?" className={textareaClass} />
              <button type="submit" className={buttonSecondary}>
                Add note
              </button>
            </Form>

            {notes.length === 0 ? (
              <p className="mt-3 text-[13px] text-slate-500">No notes yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {notes.map((note) => (
                  <li key={note.id} className="py-2.5">
                    <p className="text-sm text-slate-900">{note.body}</p>
                    <p className="mt-0.5 text-[13px] text-slate-500">
                      {note.authorName}, {formatDateTime(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Events and sessions</h2>
            {connections.length === 0 ? (
              <p className="mt-2 text-[13px] text-slate-500">Not connected to any event yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {connections.map((connection) => (
                  <li key={connection.eventId} className="py-2.5">
                    <p className="text-[13px] font-medium text-slate-900">
                      <Link to={`/admin/${connection.eventId}/speakers/${contact.id}`} className="hover:text-accent">
                        {connection.eventName}
                      </Link>
                      <span className="ml-2 font-normal capitalize text-slate-500">{connection.role}</span>
                    </p>
                    {connection.sessions.length > 0 ? (
                      <ul className="mt-1 space-y-0.5">
                        {connection.sessions.map((session) => (
                          <li key={session.id} className="text-[13px] text-slate-500">
                            <Link to={`/admin/${connection.eventId}/submissions/${session.id}`} className="hover:text-accent">
                              {session.title}
                            </Link>
                            {session.statusLabel ? `, ${session.statusLabel}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-0.5 text-[13px] text-slate-500">On the roster, no sessions.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <Form method="post" className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="intent" value="add-to-event" />
              <label htmlFor="eventId" className="text-[13px] text-slate-500">
                Add to event
              </label>
              <select id="eventId" name="eventId" className={`${selectSized} w-56 flex-none`}>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
              <button type="submit" className={buttonSecondary}>
                Add
              </button>
            </Form>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Tags</h2>
            <Form method="post" className="mt-2 space-y-2">
              <input type="hidden" name="intent" value="save-tags" />
              <label htmlFor="tags" className="sr-only">
                Tags
              </label>
              <input
                id="tags"
                name="tags"
                defaultValue={contact.tags.join(", ")}
                placeholder="AI, keynote, returning"
                className={inputClass}
              />
              <p className="text-[13px] text-slate-500">Comma separated.</p>
              <button type="submit" className={buttonSecondary}>
                Save tags
              </button>
            </Form>
            {contact.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {contact.tags.map((tag) => (
                  <Link
                    key={tag}
                    to={`/crm/contacts?tag=${encodeURIComponent(tag)}`}
                    className="inline-flex h-6 items-center rounded-full border border-slate-200 px-2 text-xs font-medium text-slate-900 hover:border-accent hover:text-accent"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Custom fields</h2>
              <Link to="/crm/fields" className="text-[13px] font-medium text-accent hover:underline">
                Manage
              </Link>
            </div>
            {fields.length === 0 ? (
              <p className="mt-2 text-[13px] text-slate-500">
                No custom fields yet. Create one under Fields to track anything this org cares about.
              </p>
            ) : (
              <Form method="post" className="mt-2 space-y-3">
                <input type="hidden" name="intent" value="save-custom" />
                {fields.map((field) => {
                  const options = JSON.parse(field.optionsJson || "[]") as string[];
                  const value = contact.custom[field.fieldKey] ?? "";
                  return (
                    <Field key={field.id} label={field.label} name={`custom_${field.fieldKey}`}>
                      {field.type === "select" ? (
                        <select id={`custom_${field.fieldKey}`} name={`custom_${field.fieldKey}`} defaultValue={value} className={selectClass}>
                          <option value="">Not set</option>
                          {options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input id={`custom_${field.fieldKey}`} name={`custom_${field.fieldKey}`} defaultValue={value} className={inputClass} />
                      )}
                    </Field>
                  );
                })}
                <button type="submit" className={buttonSecondary}>
                  Save fields
                </button>
              </Form>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
            {activity.length === 0 ? (
              <p className="mt-2 text-[13px] text-slate-500">Nothing recorded yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {activity.slice(0, 25).map((entry, index) => (
                  <li key={`${entry.kind}-${index}`} className="py-2">
                    <p className="text-[13px] font-medium text-slate-900">{entry.title}</p>
                    {entry.detail ? <p className="text-[13px] text-slate-500">{entry.detail}</p> : null}
                    <p className="text-xs text-slate-500">
                      {entry.author}, {formatDateTime(entry.at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
