// Every email this event has sent or queued, the templates behind them, and the
// scheduled work that produces them. Templates are editable here and read by every
// send path, so an edit applies to decisions, reminders, digests, and portal mail.

import { Form, Link, useSearchParams } from "react-router";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/event.communications";
import { bindings, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import {
  getTemplate,
  listTemplates,
  mergeVars,
  recentSends,
  resetTemplate,
  saveTemplate,
  MERGE_TAGS,
} from "../lib/comms.server";
import { deliverEmail, renderTemplate, sendEmail } from "../lib/email";
import { reminderRecipients, digestRecipients, sendFormReminders, sendSpeakerDigest } from "../lib/notifications.server";
import { formatDate, formatDateTime } from "../lib/format";
import { emailSends, events, forms, jobs } from "../../database/schema";
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
  inputSized,
  selectSized,
  textareaClass,
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
  const templateFilter = url.searchParams.get("template_key") ?? "";
  const selectedKey = url.searchParams.get("template") ?? "";

  const all = await recentSends(eventId);
  const sends = all
    .filter((row) => (q ? row.subject.toLowerCase().includes(q) || row.toEmail.toLowerCase().includes(q) : true))
    .filter((row) => (status ? row.status === status : true))
    .filter((row) => (templateFilter ? (row.templateKey ?? "") === templateFilter : true));

  const templates = await listTemplates(eventId);
  const template = selectedKey ? await getTemplate(eventId, selectedKey) : null;

  // Open forms drive the reminder schedule; the counts make the button honest about
  // how many people it would actually mail.
  const openForms = await db
    .select({ id: forms.id, name: forms.name, closesAt: forms.closesAt })
    .from(forms)
    .where(and(eq(forms.eventId, eventId), eq(forms.status, "published")))
    .orderBy(asc(forms.closesAt))
    .all();
  const reminderTargets = [];
  for (const form of openForms) {
    reminderTargets.push({
      id: form.id,
      name: form.name,
      closesAt: form.closesAt,
      pending: (await reminderRecipients(form.id)).length,
    });
  }

  const scheduled = await db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      runAfter: jobs.runAfter,
      attempts: jobs.attempts,
      lastError: jobs.lastError,
      payloadJson: jobs.payloadJson,
    })
    .from(jobs)
    .where(inArray(jobs.status, ["pending", "running", "failed"]))
    .orderBy(asc(jobs.runAfter))
    .limit(20)
    .all();

  return {
    event,
    sends: sends.map((row) => ({
      id: row.id,
      subject: row.subject,
      toEmail: row.toEmail,
      toContactId: row.toContactId,
      status: row.status,
      templateKey: row.templateKey,
      icsAttached: row.icsAttached,
      createdAt: row.createdAt,
      sentAt: row.sentAt,
      error: row.error,
    })),
    total: all.length,
    queued: all.filter((row) => row.status === "queued").length,
    failed: all.filter((row) => row.status === "failed").length,
    filters: { q: url.searchParams.get("q") ?? "", status, templateKey: templateFilter },
    templateKeys: [...new Set(all.map((row) => row.templateKey).filter((key): key is string => Boolean(key)))].sort(),
    templates,
    template,
    selectedKey,
    mergeTags: MERGE_TAGS,
    reminderTargets,
    digestPending: (await digestRecipients(eventId)).length,
    scheduled,
    userEmail: user.email,
    providerConfigured: Boolean(bindings.BREVO_API_KEY),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-template") {
    const key = String(form.get("templateKey") ?? "").trim();
    const subject = String(form.get("subject") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    if (!key) return { error: "Pick a template first.", notice: null };
    if (!subject || !body) return { error: "A template needs a subject and a body.", notice: null };
    await saveTemplate(eventId, { key, name: String(form.get("name") ?? key), subject, body });
    return { error: null, notice: "Template saved. Every send that uses this template now uses the new copy." };
  }

  if (intent === "reset-template") {
    const key = String(form.get("templateKey") ?? "").trim();
    await resetTemplate(eventId, key);
    return { error: null, notice: "Template reset to the built-in copy." };
  }

  if (intent === "test-send") {
    const toEmail = String(form.get("toEmail") ?? "").trim();
    const subject = String(form.get("subject") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    if (!toEmail.includes("@")) return { error: "Enter an email address to send the test to.", notice: null };
    if (!subject || !body) return { error: "Pick a template first.", notice: null };

    const vars = mergeVars(
      event,
      { contactId: 0, name: user.name, firstName: user.name.split(" ")[0], email: toEmail },
      {
        talk_title: "Sample session title",
        task_list: "<ul><li>Sample outstanding item</li></ul>",
        session_time: "May 12, 2027, 10:00 AM",
        room_name: "Room 2A",
        form_name: "Call for Proposals",
        close_date: "April 30, 2027",
        reason: "Your draft has not been submitted yet.",
      }
    );

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

  // The cron runs these on its own schedule. The buttons exist so the flow can be
  // proved now, and so an organizer can force a send after fixing a template.
  if (intent === "run-reminders") {
    const formId = Number(form.get("formId") ?? 0);
    const queued = await sendFormReminders(formId, 0);
    return {
      error: null,
      notice:
        queued === 0
          ? "Nobody has an unfinished draft or an incomplete profile on that form."
          : `Queued ${queued} reminder ${queued === 1 ? "email" : "emails"}.`,
    };
  }

  if (intent === "run-digest") {
    const queued = await sendSpeakerDigest(eventId);
    return {
      error: null,
      notice:
        queued === 0
          ? "No opted-in speaker has an open task or an outstanding file."
          : `Queued ${queued} digest ${queued === 1 ? "email" : "emails"}.`,
    };
  }

  // Deliver everything still queued, rather than waiting for the next cron tick.
  if (intent === "flush-queue") {
    const pending = await db
      .select({ id: emailSends.id })
      .from(emailSends)
      .where(and(eq(emailSends.eventId, eventId), eq(emailSends.status, "queued")))
      .orderBy(desc(emailSends.id))
      .limit(50)
      .all();
    let sent = 0;
    for (const row of pending) {
      const status = await deliverEmail(bindings, row.id);
      if (status === "sent" || status === "test") sent += 1;
    }
    return {
      error: null,
      notice: pending.length === 0 ? "Nothing is queued." : `Attempted delivery of ${pending.length}, ${sent} accepted.`,
    };
  }

  return { error: null, notice: null };
}

export default function Communications({ loaderData, actionData, params }: Route.ComponentProps) {
  const {
    event,
    sends,
    total,
    queued,
    failed,
    filters,
    templateKeys,
    templates,
    template,
    selectedKey,
    mergeTags,
    reminderTargets,
    digestPending,
    scheduled,
    userEmail,
    providerConfigured,
  } = loaderData;
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
        description={`${total} recorded, ${queued} queued, ${failed} failed, for ${event.name}.`}
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

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
              <Form method="get" className="flex flex-1 flex-wrap items-center gap-2">
                {selectedKey ? <input type="hidden" name="template" value={selectedKey} /> : null}
                <input
                  name="q"
                  defaultValue={filters.q}
                  placeholder="Search subject or recipient"
                  aria-label="Search messages"
                  className={`${inputSized} w-56 flex-none`}
                />
                <select name="status" defaultValue={filters.status} aria-label="Filter by status" className={`${selectSized} w-36 flex-none`}>
                  <option value="">Any status</option>
                  <option value="queued">Queued</option>
                  <option value="sent">Sent</option>
                  <option value="test">Test</option>
                  <option value="failed">Failed</option>
                </select>
                <select
                  name="template_key"
                  defaultValue={filters.templateKey}
                  aria-label="Filter by template"
                  className={`${selectSized} w-44 flex-none`}
                >
                  <option value="">Any template</option>
                  {templateKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
                <button type="submit" className={buttonSecondary}>
                  Filter
                </button>
              </Form>
              <Form method="post">
                <button type="submit" name="intent" value="flush-queue" className={buttonSecondary}>
                  Deliver queued now
                </button>
              </Form>
            </div>

            {sends.length === 0 ? (
              <EmptyState
                message={total === 0 ? "Nothing sent yet. Decision emails and speaker mail land here." : "No messages match this filter."}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[840px] text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th scope="col" className="px-3 py-2 font-medium">Subject</th>
                      <th scope="col" className="px-3 py-2 font-medium">To</th>
                      <th scope="col" className="px-3 py-2 font-medium">Template</th>
                      <th scope="col" className="px-3 py-2 font-medium">Status</th>
                      <th scope="col" className="px-3 py-2 font-medium">Recorded</th>
                      <th scope="col" className="px-3 py-2 font-medium">Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sends.map((send) => (
                      <tr key={send.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="h-10 max-w-[280px] truncate px-3 font-medium text-slate-900">
                          {send.subject}
                          {send.icsAttached ? <span className="ml-2 text-slate-500">calendar attached</span> : null}
                        </td>
                        <td className="max-w-[180px] truncate px-3 text-slate-500">
                          {send.toContactId ? (
                            <Link to={`${base}/speakers/${send.toContactId}`} className="hover:text-accent">
                              {send.toEmail}
                            </Link>
                          ) : (
                            send.toEmail
                          )}
                        </td>
                        <td className="px-3 text-slate-500">{send.templateKey ?? ""}</td>
                        <td className="px-3 text-slate-900">
                          {send.status}
                          {send.error ? <span className="block max-w-[200px] truncate text-slate-500">{send.error}</span> : null}
                        </td>
                        <td className="whitespace-nowrap px-3 text-slate-500">{formatDateTime(send.createdAt, event.timezone)}</td>
                        <td className="whitespace-nowrap px-3 text-slate-500">
                          {send.sentAt ? formatDateTime(send.sentAt, event.timezone) : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Scheduled sends</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">
              The cron runs every five minutes. Reminders are scheduled from each form's reminder days before it closes;
              the digest runs once a week per event.
            </p>

            <div className="mt-3 space-y-2">
              {reminderTargets.length === 0 ? (
                <p className="text-[13px] text-slate-500">No published form, so there is nothing to remind anyone about.</p>
              ) : (
                reminderTargets.map((target) => (
                  <div key={target.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <p className="text-[13px] text-slate-900">
                      {target.name}
                      <span className="text-slate-500">
                        {target.closesAt ? `, closes ${formatDate(target.closesAt, event.timezone)}` : ""}, {target.pending}{" "}
                        {target.pending === 1 ? "person" : "people"} with unfinished work
                      </span>
                    </p>
                    <Form method="post">
                      <input type="hidden" name="formId" value={target.id} />
                      <button type="submit" name="intent" value="run-reminders" className={buttonSecondary}>
                        Send reminders now
                      </button>
                    </Form>
                  </div>
                ))
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-slate-900">
                  Weekly speaker digest
                  <span className="text-slate-500">
                    , {digestPending} opted-in {digestPending === 1 ? "speaker has" : "speakers have"} something outstanding
                  </span>
                </p>
                <Form method="post">
                  <button type="submit" name="intent" value="run-digest" className={buttonSecondary}>
                    Send digest now
                  </button>
                </Form>
              </div>
            </div>

            {scheduled.length > 0 ? (
              <table className="mt-4 w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="py-2 font-medium">Job</th>
                    <th scope="col" className="py-2 font-medium">Runs</th>
                    <th scope="col" className="py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduled.map((job) => (
                    <tr key={job.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 text-slate-900">
                        {job.kind}
                        <span className="ml-2 font-mono text-xs text-slate-500">{job.payloadJson}</span>
                      </td>
                      <td className="py-1.5 text-slate-500">{formatDateTime(job.runAfter, event.timezone)}</td>
                      <td className="py-1.5 text-slate-500">
                        {job.status}
                        {job.attempts > 0 ? `, ${job.attempts} ${job.attempts === 1 ? "attempt" : "attempts"}` : ""}
                        {job.lastError ? <span className="block max-w-[260px] truncate">{job.lastError}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Card>
        </div>

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
            <>
              <Form method="post" className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                <input type="hidden" name="templateKey" value={selectedKey} />
                <input type="hidden" name="name" value={template.name} />

                <Field label="Subject" name="subject" required>
                  <input id="subject" name="subject" defaultValue={template.subject} className={inputClass} required />
                </Field>
                <Field label="Body" name="body" required help="HTML. Merge tags are replaced per recipient.">
                  <textarea id="body" name="body" rows={10} defaultValue={template.body} className={`${textareaClass} font-mono text-xs`} required />
                </Field>

                <div className="flex flex-wrap items-center gap-2">
                  <button type="submit" name="intent" value="save-template" className={buttonPrimary}>
                    Save template
                  </button>
                  <button type="submit" name="intent" value="reset-template" className={buttonSecondary}>
                    Reset to built-in
                  </button>
                </div>
              </Form>

              <Form method="post" className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="intent" value="test-send" />
                <input type="hidden" name="templateKey" value={selectedKey} />
                <input type="hidden" name="subject" value={template.subject} />
                <input type="hidden" name="body" value={template.body} />
                <Field label="Send a test to" name="toEmail" help="Sends the saved copy with sample values filled in.">
                  <input id="toEmail" name="toEmail" type="email" defaultValue={userEmail} className={inputClass} />
                </Field>
                <button type="submit" className={buttonSecondary}>
                  Send test
                </button>
              </Form>
            </>
          ) : (
            <p className="mt-3 text-[13px] text-slate-500">Pick a template to edit it and send yourself a test.</p>
          )}

          <h3 className="mt-5 text-sm font-semibold text-slate-900">Merge tags</h3>
          <dl className="mt-2 space-y-1.5">
            {mergeTags.map((tag) => (
              <div key={tag.tag} className="flex gap-2 text-[13px]">
                <dt className="shrink-0 font-mono text-xs text-slate-900">{tag.tag}</dt>
                <dd className="text-slate-500">{tag.meaning}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
