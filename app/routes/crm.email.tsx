// Bulk outreach from the directory. Merge tags resolve per recipient, the preview
// shows the first one fully rendered, and every message is recorded in email_sends
// so the send has an in-app history whether or not a provider key is set.

import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/crm.email";
import { requireOrganizer } from "../lib/session.server";
import { contactsByIds } from "../lib/crm.server";
import { listEventsForPicker } from "../lib/crm.server";
import { Breadcrumbs, Card, ErrorNotice, Field, Notice, PageHeader, buttonPrimary, buttonSecondary, inputClass, selectClass, textareaClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Email contacts" }];
}

function idsFrom(url: URL): number[] {
  return url.searchParams
    .getAll("ids")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
}

const DEFAULT_SUBJECT = "Speak at our next event?";
const DEFAULT_BODY =
  "<p>Hi {first_name},</p><p>We are putting the programme together and would like you to submit a talk.</p><p>{portal_url}</p>";

export async function loader({ request }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const { mergeVars, MERGE_TAGS } = await import("../lib/comms.server");
  const { renderTemplate } = await import("../lib/email");

  const url = new URL(request.url);
  const ids = idsFrom(url);
  const recipients = ids.length > 0 ? await contactsByIds(ids) : [];
  const events = await listEventsForPicker();

  // The preview is rendered here, not in the component: merge-tag resolution is
  // server code and must not reach the client bundle.
  const first = recipients[0];
  const vars = first
    ? mergeVars(
        { id: events[0]?.id ?? 0, name: events[0]?.name ?? "the event" },
        { contactId: first.id, name: first.name, firstName: first.firstName || first.name, email: first.email }
      )
    : null;

  return {
    recipients,
    events,
    ids,
    defaults: { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY },
    preview: vars
      ? {
          name: first.name,
          subject: renderTemplate(DEFAULT_SUBJECT, vars),
          body: renderTemplate(DEFAULT_BODY, vars).replace(/<[^>]+>/g, " ").trim(),
        }
      : null,
    mergeTags: MERGE_TAGS.slice(0, 4).map((tag) => tag.tag),
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireOrganizer(request);
  const form = await request.formData();
  const ids = form.getAll("ids").map(Number).filter(Number.isInteger);
  const subject = String(form.get("subject") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const eventId = Number(form.get("eventId") ?? 0);

  if (ids.length === 0) return { error: "Nobody selected.", notice: null };
  if (!subject || !body) return { error: "Enter a subject and a body.", notice: null };

  const { queueBulk } = await import("../lib/comms.server");
  const events = await listEventsForPicker();
  const event = events.find((row) => row.id === eventId) ?? events[0];
  if (!event) return { error: "Create an event first: outreach is sent in the name of one.", notice: null };

  const recipients = await contactsByIds(ids);
  const queued = await queueBulk({
    event: { id: event.id, name: event.name },
    templateKey: "crm_outreach",
    subject,
    body,
    recipients: recipients.map((row) => ({
      person: { contactId: row.id, name: row.name, firstName: row.firstName || row.name, email: row.email },
      extras: { company: row.company ?? "", job_title: row.title ?? "" },
    })),
  });

  return {
    error: null,
    notice: `Queued ${queued} ${queued === 1 ? "message" : "messages"}. Every one is in Communications for ${event.name}.`,
  };
}

export default function CrmEmail({ loaderData, actionData }: Route.ComponentProps) {
  const { recipients, events, mergeTags, ids, defaults, preview } = loaderData;
  const [searchParams] = useSearchParams();

  return (
    <>
      <Breadcrumbs items={[{ to: `/crm/contacts?${searchParams.toString()}`, label: "Directory" }, { label: "Email" }]} />

      <PageHeader
        title="Email contacts"
        description={`${recipients.length} ${recipients.length === 1 ? "recipient" : "recipients"} selected.`}
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? (
        <Notice>
          {actionData.notice}{" "}
          <Link to={`/admin/${events[0]?.id ?? 1}/communications`} className="font-medium text-accent hover:underline">
            Open Communications
          </Link>
        </Notice>
      ) : null}

      {recipients.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-slate-500">
            Nobody is selected.{" "}
            <Link to="/crm/contacts" className="font-medium text-accent hover:underline">
              Pick contacts in the directory
            </Link>{" "}
            and use Send email.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_340px] [&>*]:min-w-0">
          <Card className="p-4">
            <Form method="post" className="space-y-3">
              {ids.map((id) => (
                <input key={id} type="hidden" name="ids" value={id} />
              ))}
              <Field label="Send in the name of" name="eventId">
                <select id="eventId" name="eventId" className={selectClass}>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Subject" name="subject" required>
                <input id="subject" name="subject" defaultValue={defaults.subject} className={inputClass} required />
              </Field>
              <Field label="Body" name="body" required help="HTML. Merge tags resolve per recipient.">
                <textarea id="body" name="body" rows={8} defaultValue={defaults.body} className={`${textareaClass} font-mono text-xs`} required />
              </Field>
              <button type="submit" className={buttonPrimary}>
                Send to {recipients.length} {recipients.length === 1 ? "contact" : "contacts"}
              </button>
            </Form>

            <p className="mt-3 text-[13px] text-slate-500">
              Reusable copy lives in the event's templates under Communications.
            </p>
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-900">Preview for {preview?.name}</h2>
              <p className="mt-1 text-[13px] text-slate-500">Merge tags resolved with this recipient's own values.</p>
              <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-sm text-slate-900">
                <p className="font-medium">{preview?.subject}</p>
                <p className="mt-1 text-[13px]">{preview?.body}</p>
              </div>
              <p className="mt-2 text-[13px] text-slate-500">Available: {mergeTags.join(", ")}</p>
            </Card>

            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-900">Recipients</h2>
              <ul className="mt-2 divide-y divide-slate-100">
                {recipients.map((row) => (
                  <li key={row.id} className="py-1.5 text-[13px]">
                    <span className="font-medium text-slate-900">{row.name}</span>
                    <span className="block truncate text-slate-500">{row.email}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
