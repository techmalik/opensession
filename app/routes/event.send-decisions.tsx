// The explicit decision-email step, matching Sessionboard: statuses change first,
// emails go out from here. Sending an acceptance moves Accept Queue items to
// Accepted, stamps decisionEmailSentAt, and converts the abstract into a session.
// Acceptance emails carry an .ics for the event dates.

import { Form, Link } from "react-router";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import type { Route } from "./+types/event.send-decisions";
import { appBaseUrl, bindings, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { renderTemplate, sendEmail } from "../lib/email";
import { buildIcs } from "../lib/ics";
import { contacts, events, sessionParticipants, sessions, statuses } from "../../database/schema";
import { Breadcrumbs, Card, Field, PageHeader, buttonPrimary, buttonSecondary, inputClass, textareaClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Send decision emails" }];
}

type Queue = "accept_queue" | "decline_queue";

interface Recipient {
  sessionId: number;
  friendlyId: string;
  title: string;
  statusLabel: string;
  speakerName: string;
  speakerEmail: string;
  contactId: number | null;
}

/** Everyone a send would reach: queue members plus already-decided submissions whose
 *  email has not gone out yet (covers organizers who set Accepted directly). */
async function loadRecipients(eventId: number, queue: Queue): Promise<Recipient[]> {
  const db = getDb();
  const finalKey = queue === "accept_queue" ? "accepted" : "declined";

  const rows = await db
    .select({
      sessionId: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      statusKey: statuses.key,
      statusLabel: statuses.label,
      submittedBy: sessions.submittedBy,
    })
    .from(sessions)
    .innerJoin(statuses, eq(sessions.statusId, statuses.id))
    .where(
      and(
        eq(sessions.eventId, eventId),
        eq(sessions.isDraft, false),
        isNull(sessions.decisionEmailSentAt),
        or(eq(statuses.key, queue), eq(statuses.key, finalKey))
      )
    )
    .orderBy(asc(sessions.id))
    .all();

  const recipients: Recipient[] = [];
  for (const row of rows) {
    // The lead speaker (sort 0) gets the decision email; fall back to the submitter.
    const lead = await db
      .select({
        contactId: sessionParticipants.contactId,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
      })
      .from(sessionParticipants)
      .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
      .where(eq(sessionParticipants.sessionId, row.sessionId))
      .orderBy(asc(sessionParticipants.sort), asc(sessionParticipants.id))
      .get();

    let name = `${lead?.firstName ?? ""} ${lead?.lastName ?? ""}`.trim();
    let email = lead?.email ?? "";
    let contactId = lead?.contactId ?? null;
    if (!email && row.submittedBy) {
      const fallback = await db.select().from(contacts).where(eq(contacts.id, row.submittedBy)).get();
      if (fallback) {
        name = `${fallback.firstName} ${fallback.lastName}`.trim();
        email = fallback.email;
        contactId = fallback.id;
      }
    }
    if (!email) continue;
    recipients.push({
      sessionId: row.sessionId,
      friendlyId: row.friendlyId,
      title: row.title,
      statusLabel: row.statusLabel,
      speakerName: name || email,
      speakerEmail: email,
      contactId,
    });
  }
  return recipients;
}

/** One source for decision copy: whatever Communications holds for the key, or the
 *  built-in default. Editing the template there changes what goes out from here. */
async function defaultTemplate(eventId: number, queue: Queue): Promise<{ subject: string; body: string }> {
  const { getTemplate } = await import("../lib/comms.server");
  const template = await getTemplate(eventId, queue === "accept_queue" ? "acceptance" : "decline");
  return { subject: template.subject, body: template.body };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const queueParam = url.searchParams.get("queue");
  const queue: Queue | null = queueParam === "accept_queue" || queueParam === "decline_queue" ? queueParam : null;

  const acceptRecipients = await loadRecipients(eventId, "accept_queue");
  const declineRecipients = await loadRecipients(eventId, "decline_queue");

  return {
    event,
    queue,
    acceptCount: acceptRecipients.length,
    declineCount: declineRecipients.length,
    recipients: queue === "accept_queue" ? acceptRecipients : queue === "decline_queue" ? declineRecipients : [],
    template: queue ? await defaultTemplate(eventId, queue) : null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select().from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const form = await request.formData();
  const queueRaw = String(form.get("queue") ?? "");
  if (queueRaw !== "accept_queue" && queueRaw !== "decline_queue") return { error: "Unknown queue." };
  const queue: Queue = queueRaw;

  const subject = String(form.get("subject") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (!subject || !body) return { error: "Enter a subject and a body." };

  const recipients = await loadRecipients(eventId, queue);
  if (recipients.length === 0) return { error: "No submissions are waiting for this decision email." };

  const finalKey = queue === "accept_queue" ? "accepted" : "declined";
  const finalStatus = await db
    .select({ id: statuses.id, label: statuses.label })
    .from(statuses)
    .where(and(eq(statuses.eventId, eventId), eq(statuses.key, finalKey)))
    .get();
  if (!finalStatus) return { error: "The decision status is missing for this event." };

  const ics =
    queue === "accept_queue" && event.startsAt && event.endsAt
      ? buildIcs({
          uid: `opensession-event-${event.id}@opensession`,
          title: event.name,
          description: event.description,
          location: event.location,
          start: event.startsAt,
          end: event.endsAt,
          url: `${appBaseUrl()}/`,
        })
      : null;

  const now = new Date();
  const sent: { title: string; email: string; status: string }[] = [];
  for (const recipient of recipients) {
    const vars = {
      speaker_name: recipient.speakerName,
      talk_title: recipient.title,
      event_name: event.name,
      status: finalStatus.label,
      portal_url: `${appBaseUrl()}/portal`,
    };
    const result = await sendEmail(bindings, {
      eventId,
      templateKey: queue === "accept_queue" ? "acceptance" : "decline",
      toEmail: recipient.speakerEmail,
      toContactId: recipient.contactId ?? undefined,
      toName: recipient.speakerName,
      subject: renderTemplate(subject, vars),
      bodyHtml: renderTemplate(body, vars),
      ics: ics ? { filename: "event.ics", content: ics } : undefined,
    });

    await db
      .update(sessions)
      .set({
        statusId: finalStatus.id,
        decisionEmailSentAt: now,
        isAbstract: queue === "accept_queue" ? false : true,
        updatedAt: now,
      })
      .where(eq(sessions.id, recipient.sessionId));

    sent.push({ title: recipient.title, email: recipient.speakerEmail, status: result.status });
  }

  return {
    error: null,
    sent,
    sentQueue: queue,
    sentLabel: finalStatus.label,
    sentAt: now.toISOString(),
  };
}

export default function SendDecisions({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, queue, acceptCount, declineCount, recipients, template } = loaderData;

  const sent = actionData && "sent" in actionData ? actionData.sent : null;

  if (sent) {
    return (
      <>
        <PageHeader title="Decision emails sent" description={`${sent.length} ${sent.length === 1 ? "email" : "emails"} recorded and dispatched.`} />
        <Card className="max-w-[720px]">
          <ul className="divide-y divide-slate-100">
            {sent.map((row, index) => (
              <li key={index} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-900">{row.title}</p>
                  <p className="text-[13px] text-slate-500">{row.email}</p>
                </div>
                <p className="text-[13px] text-slate-500">
                  {row.status === "sent" ? "Sent" : row.status === "test" ? "Logged (test mode, no provider key)" : row.status}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-3">
            <Link to={`/admin/${params.eventId}/submissions`} className={buttonPrimary}>
              Back to Submissions
            </Link>
            <Link to={`/admin/${params.eventId}/submissions/send-decisions`} className={buttonSecondary}>
              Send more
            </Link>
          </div>
        </Card>
      </>
    );
  }

  if (!queue) {
    return (
      <>
        <Breadcrumbs items={[{ to: `/admin/${params.eventId}/submissions`, label: "Submissions" }, { label: "Send decision emails" }]} />

        <PageHeader
          title="Send decision emails"
          description="Recording a decision does not email anyone. This step does. Each send is logged under Communications."
        />

        <div className="grid max-w-[720px] gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Acceptances</h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{acceptCount}</p>
            <p className="mt-0.5 text-[13px] text-slate-500">In the Accept Queue or accepted without an email yet.</p>
            {acceptCount > 0 ? (
              <Link to={`?queue=accept_queue`} className={`${buttonPrimary} mt-3`}>
                Compose acceptance email
              </Link>
            ) : (
              <p className="mt-3 text-[13px] text-slate-500">Nothing waiting.</p>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Declines</h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{declineCount}</p>
            <p className="mt-0.5 text-[13px] text-slate-500">In the Decline Queue or declined without an email yet.</p>
            {declineCount > 0 ? (
              <Link to={`?queue=decline_queue`} className={`${buttonSecondary} mt-3`}>
                Compose decline email
              </Link>
            ) : (
              <p className="mt-3 text-[13px] text-slate-500">Nothing waiting.</p>
            )}
          </Card>
        </div>
      </>
    );
  }

  const isAccept = queue === "accept_queue";

  return (
    <>
      <Breadcrumbs items={[{ to: `/admin/${params.eventId}/submissions/send-decisions`, label: "Send decision emails" }, { label: isAccept ? "Acceptances" : "Declines" }]} />

      <PageHeader
        title={isAccept ? "Send acceptance emails" : "Send decline emails"}
        description={
          isAccept
            ? "Sending moves these submissions to Accepted, converts them to sessions, and attaches the event calendar file."
            : "Sending moves these submissions to Declined."
        }
      />

      <div className="grid max-w-[960px] gap-4 lg:grid-cols-[1fr_340px]">
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
            <input type="hidden" name="queue" value={queue} />
            <Field label="Subject" name="subject" required help="Merge tags: {speaker_name}, {talk_title}, {event_name}, {status}, {portal_url}.">
              <input id="subject" name="subject" defaultValue={template?.subject ?? ""} className={inputClass} required />
            </Field>
            <Field label="Body" name="body" required>
              <textarea id="body" name="body" rows={8} defaultValue={template?.body ?? ""} className={textareaClass} required />
            </Field>
            <button type="submit" className={buttonPrimary} disabled={recipients.length === 0}>
              Send {recipients.length} {recipients.length === 1 ? "email" : "emails"}
            </button>
          </Form>
        </Card>

        <Card>
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Recipients ({recipients.length})</h2>
          </div>
          {recipients.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">Nothing waiting for this email.</p>
          ) : (
            <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
              {recipients.map((recipient) => (
                <li key={recipient.sessionId} className="px-4 py-2.5">
                  <p className="text-sm font-medium text-slate-900">{recipient.title}</p>
                  <p className="text-[13px] text-slate-500">
                    {recipient.speakerName}, {recipient.speakerEmail}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
