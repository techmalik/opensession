// Every email this event has sent or queued, plus the templates behind them and a
// test-send so an organizer can check the copy against a real inbox.

import { Form, Link, useSearchParams } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.communications";
import { bindings, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { getTemplate, listTemplates, mergeVars, recentSends } from "../lib/comms.server";
import { renderTemplate, sendEmail, MERGE_TAG_HELP } from "../lib/email";
import { formatDateTime } from "../lib/format";
import { events } from "../../database/schema";
import {
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Notice,
  PageHeader,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Communications" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const status = url.searchParams.get("status") ?? "";
  const selectedKey = url.searchParams.get("template") ?? "";

  const all = await recentSends(eventId);
  const sends = all
    .filter((row) => (q ? row.subject.toLowerCase().includes(q) || row.toEmail.toLowerCase().includes(q) : true))
    .filter((row) => (status ? row.status === status : true));

  const templates = await listTemplates(eventId);
  const template = selectedKey ? await getTemplate(eventId, selectedKey) : null;

  return {
    event,
    sends: sends.map((row) => ({
      id: row.id,
      subject: row.subject,
      toEmail: row.toEmail,
      status: row.status,
      templateKey: row.templateKey,
      icsAttached: row.icsAttached,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      error: row.error,
    })),
    total: all.length,
    filters: { q: url.searchParams.get("q") ?? "", status },
    templates,
    template,
    selectedKey,
    userEmail: user.email,
    providerConfigured: Boolean(bindings.BREVO_API_KEY),
    mergeHelp: MERGE_TAG_HELP,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const form = await request.formData();
  if (String(form.get("intent")) !== "test-send") return { error: null, notice: null };

  const toEmail = String(form.get("toEmail") ?? "").trim();
  const subject = String(form.get("subject") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (!toEmail.includes("@")) return { error: "Enter an email address to send the test to.", notice: null };
  if (!subject || !body) return { error: "Pick a template first.", notice: null };

  const vars = mergeVars(event, { contactId: 0, name: user.name, firstName: user.name.split(" ")[0], email: toEmail }, {
    talk_title: "Sample session title",
    task_list: "<ul><li>Sample outstanding item</li></ul>",
    session_time: "May 12, 2027, 10:00 AM",
    room_name: "Room 2A",
  });

  const result = await sendEmail(bindings, {
    eventId,
    templateKey: `test:${String(form.get("templateKey") ?? "custom")}`,
    toEmail,
    subject: `[Test] ${renderTemplate(subject, vars)}`,
    bodyHtml: renderTemplate(body, vars),
  });

  return {
    error: null,
    notice:
      result.status === "sent"
        ? `Test sent to ${toEmail}.`
        : `Test recorded for ${toEmail} with status "${result.status}". Set BREVO_API_KEY to deliver for real.`,
  };
}

export default function Communications({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, sends, total, filters, templates, template, selectedKey, userEmail, providerConfigured, mergeHelp } =
    loaderData;
  const [searchParams] = useSearchParams();
  const base = `/admin/${params.eventId}`;

  const templateHref = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (key) next.set("template", key);
    else next.delete("template");
    return `?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Communications"
        description={`${total} ${total === 1 ? "message" : "messages"} recorded for ${event.name}.`}
        actions={
          <Link to={`${base}/speakers/email`} className={buttonPrimary}>
            Email speakers
          </Link>
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}
      {!providerConfigured ? (
        <Notice>
          No email provider key is set, so sends are recorded with status "test" instead of leaving the building. Set
          BREVO_API_KEY to deliver for real.
        </Notice>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
            <Form method="get" className="flex flex-1 flex-wrap items-center gap-2">
              {selectedKey ? <input type="hidden" name="template" value={selectedKey} /> : null}
              <input
                name="q"
                defaultValue={filters.q}
                placeholder="Search subject or recipient"
                aria-label="Search messages"
                className={`${inputClass} w-64 flex-none`}
              />
              <select name="status" defaultValue={filters.status} aria-label="Filter by status" className={`${selectClass} w-40 flex-none`}>
                <option value="">Any status</option>
                <option value="queued">Queued</option>
                <option value="sent">Sent</option>
                <option value="test">Test</option>
                <option value="failed">Failed</option>
              </select>
              <button type="submit" className={buttonSecondary}>
                Filter
              </button>
            </Form>
          </div>

          {sends.length === 0 ? (
            <EmptyState
              message={total === 0 ? "Nothing sent yet. Decision emails and speaker mail land here." : "No messages match this filter."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="px-3 py-2 font-medium">Subject</th>
                    <th scope="col" className="px-3 py-2 font-medium">To</th>
                    <th scope="col" className="px-3 py-2 font-medium">Template</th>
                    <th scope="col" className="px-3 py-2 font-medium">Status</th>
                    <th scope="col" className="px-3 py-2 font-medium">Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {sends.map((send) => (
                    <tr key={send.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="h-10 max-w-[300px] truncate px-3 font-medium text-slate-900">
                        {send.subject}
                        {send.icsAttached ? <span className="ml-2 text-slate-500">calendar attached</span> : null}
                      </td>
                      <td className="max-w-[200px] truncate px-3 text-slate-500">{send.toEmail}</td>
                      <td className="px-3 text-slate-500">{send.templateKey ?? ""}</td>
                      <td className="px-3 text-slate-900">
                        {send.status}
                        {send.error ? <span className="block max-w-[200px] truncate text-slate-500">{send.error}</span> : null}
                      </td>
                      <td className="px-3 text-slate-500">{formatDateTime(send.createdAt, event.timezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Templates</h2>
          <ul className="mt-2 space-y-1">
            {templates.map((row) => (
              <li key={row.key}>
                <Link
                  to={templateHref(row.key)}
                  className={`text-[13px] font-medium ${row.key === selectedKey ? "text-accent" : "text-slate-900 hover:text-accent"}`}
                >
                  {row.name}
                </Link>
              </li>
            ))}
          </ul>

          {template ? (
            <Form method="post" className="mt-4 space-y-3">
              <input type="hidden" name="intent" value="test-send" />
              <input type="hidden" name="templateKey" value={selectedKey} />
              <input type="hidden" name="subject" value={template.subject} />
              <input type="hidden" name="body" value={template.body} />

              <div>
                <p className="text-[13px] font-medium text-slate-500">Subject</p>
                <p className="text-sm text-slate-900">{template.subject}</p>
              </div>
              <div>
                <p className="text-[13px] font-medium text-slate-500">Body</p>
                <pre className="mt-1 whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-xs text-slate-900">
                  {template.body}
                </pre>
              </div>
              <p className="text-[13px] text-slate-500">{mergeHelp}</p>

              <Field label="Send a test to" name="toEmail">
                <input id="toEmail" name="toEmail" type="email" defaultValue={userEmail} className={inputClass} />
              </Field>
              <button type="submit" className={buttonSecondary}>
                Send test
              </button>
            </Form>
          ) : (
            <p className="mt-3 text-[13px] text-slate-500">Pick a template to preview it and send yourself a test.</p>
          )}
        </Card>
      </div>
    </>
  );
}
