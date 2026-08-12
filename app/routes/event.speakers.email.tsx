// Bulk email to the speaker list. Recipients come from the roster filter you were
// looking at, or from the rows you ticked. Templates carry merge tags and the preview
// resolves them against a real recipient before anything is queued.

import { Form, Link, useSearchParams } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.speakers.email";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { getTemplate, listTemplates, mergeVars, queueBulk } from "../lib/comms.server";
import { renderTemplate, MERGE_TAG_HELP } from "../lib/email";
import { querySpeakers } from "../lib/speakers.server";
import { events } from "../../database/schema";
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
  textareaClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Email speakers" }];
}

function parseIds(value: string | null): number[] {
  return (value ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function resolveRecipients(eventId: number, url: URL) {
  const rows = await querySpeakers(eventId, {
    q: url.searchParams.get("q") ?? "",
    status: url.searchParams.get("status") ?? "",
    flag: url.searchParams.get("flag") ?? "",
  });
  const ids = parseIds(url.searchParams.get("ids"));
  return ids.length > 0 ? rows.filter((row) => ids.includes(row.contactId)) : rows;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const recipients = await resolveRecipients(eventId, url);
  const templates = await listTemplates(eventId);
  const selectedKey = url.searchParams.get("template") ?? "speaker_welcome";
  const template = await getTemplate(eventId, selectedKey);

  const previewId = Number(url.searchParams.get("preview") ?? 0);
  const sample = recipients.find((row) => row.contactId === previewId) ?? recipients[0] ?? null;
  const preview = sample
    ? (() => {
        const vars = mergeVars(event, {
          contactId: sample.contactId,
          name: sample.name,
          firstName: sample.firstName,
          email: sample.email,
        }, { talk_title: sample.sessionTitles[0] ?? "" });
        return {
          name: sample.name,
          email: sample.email,
          subject: renderTemplate(template.subject, vars),
          body: renderTemplate(template.body, vars),
        };
      })()
    : null;

  return {
    event,
    recipients: recipients.map((row) => ({
      contactId: row.contactId,
      name: row.name,
      email: row.email,
      firstName: row.firstName,
      sessionTitle: row.sessionTitles[0] ?? "",
    })),
    templates: templates.map((row) => ({ key: row.key, name: row.name })),
    template,
    selectedKey,
    preview,
    mergeHelp: MERGE_TAG_HELP,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const form = await request.formData();
  const subject = String(form.get("subject") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  const templateKey = String(form.get("templateKey") ?? "speaker_welcome");
  if (!subject || !body) return { error: "Enter a subject and a body.", sent: null };

  const contactIds = form.getAll("recipientIds").map(Number).filter(Number.isInteger);
  const rows = (await querySpeakers(eventId, {})).filter((row) => contactIds.includes(row.contactId));
  if (rows.length === 0) return { error: "No recipients selected.", sent: null };

  const queued = await queueBulk({
    event,
    templateKey,
    subject,
    body,
    recipients: rows.map((row) => ({
      person: { contactId: row.contactId, name: row.name, firstName: row.firstName, email: row.email },
      extras: { talk_title: row.sessionTitles[0] ?? "" },
    })),
  });

  return { error: null, sent: { count: queued, subject, at: new Date().toISOString() } };
}

export default function EmailSpeakers({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, recipients, templates, template, selectedKey, preview, mergeHelp } = loaderData;
  const [searchParams] = useSearchParams();
  const base = `/admin/${params.eventId}`;
  const sent = actionData?.sent ?? null;

  const previewHref = (contactId: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("template", selectedKey);
    next.set("preview", String(contactId));
    return `?${next.toString()}`;
  };

  if (sent) {
    return (
      <>
        <PageHeader
          title="Email queued"
          description={`${sent.count} ${sent.count === 1 ? "message" : "messages"} recorded and queued for delivery.`}
        />
        <Card className="max-w-[640px] p-4">
          <p className="text-sm text-slate-900">{sent.subject}</p>
          <p className="mt-1 text-[13px] text-slate-500">
            Every message is listed under Communications with its recipient and timestamp.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Link to={`${base}/communications`} className={buttonPrimary}>
              Open Communications
            </Link>
            <Link to={`${base}/speakers`} className={buttonSecondary}>
              Back to Speakers
            </Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ to: `${base}/speakers`, label: "Speakers" }, { label: "Email speakers" }]} />

      <PageHeader
        title="Email speakers"
        description={`Send to ${recipients.length} ${recipients.length === 1 ? "speaker" : "speakers"} at ${event.name}. Every send is logged under Communications.`}
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {recipients.length === 0 ? <Notice>No speakers match the current selection. Go back and widen the filter.</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
        <div className="space-y-4">
          <Card className="p-4">
            <Form method="get" className="flex flex-wrap items-end gap-2">
              {["q", "status", "flag", "ids"].map((key) =>
                searchParams.get(key) ? <input key={key} type="hidden" name={key} value={searchParams.get(key) ?? ""} /> : null
              )}
              <div className="min-w-52 flex-1">
                <Field label="Template" name="template" help="Pick a starting point. You can edit the copy before sending.">
                  <select id="template" name="template" defaultValue={selectedKey} className={selectClass}>
                    {templates.map((row) => (
                      <option key={row.key} value={row.key}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <button type="submit" className={buttonSecondary}>
                Load template
              </button>
            </Form>
          </Card>

          <Card className="p-4">
            <Form
              method="post"
              className="space-y-4"
              onSubmit={(e) => {
                if (!confirm(`This emails ${recipients.length} ${recipients.length === 1 ? "speaker" : "speakers"}. Send now?`)) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="templateKey" value={selectedKey} />
              {recipients.map((recipient) => (
                <input key={recipient.contactId} type="hidden" name="recipientIds" value={recipient.contactId} />
              ))}

              <Field label="Subject" name="subject" required help={mergeHelp}>
                <input id="subject" name="subject" defaultValue={template.subject} className={inputClass} required />
              </Field>
              <Field label="Body" name="body" required help="Basic HTML is fine.">
                <textarea id="body" name="body" rows={10} defaultValue={template.body} className={textareaClass} required />
              </Field>

              <button type="submit" className={buttonPrimary} disabled={recipients.length === 0}>
                Send to {recipients.length} {recipients.length === 1 ? "speaker" : "speakers"}
              </button>
            </Form>
          </Card>

          {preview ? (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-900">Preview for {preview.name}</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">
                {preview.email}. Merge tags resolved against this recipient, from the saved template.
              </p>
              <p className="mt-3 text-[13px] font-medium text-slate-500">Subject</p>
              <p className="text-sm text-slate-900">{preview.subject}</p>
              <p className="mt-3 text-[13px] font-medium text-slate-500">Body</p>
              <div
                className="mt-1 space-y-2 text-sm text-slate-900 [&_p]:leading-relaxed"
                dangerouslySetInnerHTML={{ __html: preview.body }}
              />
            </Card>
          ) : null}
        </div>

        <Card>
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Recipients ({recipients.length})</h2>
          </div>
          {recipients.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">Nobody selected.</p>
          ) : (
            <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {recipients.map((recipient) => (
                <li key={recipient.contactId} className="flex items-center justify-between gap-2 px-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{recipient.name}</p>
                    <p className="truncate text-[13px] text-slate-500">{recipient.email}</p>
                  </div>
                  <Link to={previewHref(recipient.contactId)} className="shrink-0 text-[13px] font-medium text-accent hover:underline">
                    Preview
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
