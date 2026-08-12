// One speaker, everything about them: profile (editable here and in their portal),
// roster status, sessions, task progress, uploaded files, and their email history.

import { Form, Link } from "react-router";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Route } from "./+types/event.speaker";
import { bindings, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { getTemplate, queueBulk } from "../lib/comms.server";
import { newBlobKey, putFile } from "../lib/storage";
import { taskMatrix } from "../lib/tasks.server";

import { formatBytes, formatDate, formatDateTime, formatTimeOfDay } from "../lib/format";
import { ROLE_LABEL, SPEAKER_STATUS_LABEL, type SpeakerStatus } from "../lib/labels";
import {
  contacts,
  emailSends,
  eventContacts,
  events,
  fileRequests,
  fileUploads,
  rooms,
  sessionParticipants,
  sessions,
  statuses,
  taskCompletions,
} from "../../database/schema";
import {
  ApprovalBadge,
  Breadcrumbs,
  Card,
  ErrorNotice,
  Field,
  Notice,
  PageHeader,
  TaskBadge,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
  textareaClass,
} from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.speaker ? `${loaderData.speaker.firstName} ${loaderData.speaker.lastName}` : "Speaker" }];
}

const MAX_HEADSHOT_BYTES = 5 * 1024 * 1024;

async function loadSpeaker(eventId: number, contactId: number) {
  const db = getDb();
  const row = await db
    .select({
      contact: contacts,
      status: eventContacts.status,
    })
    .from(eventContacts)
    .innerJoin(contacts, eq(eventContacts.contactId, contacts.id))
    .where(and(eq(eventContacts.eventId, eventId), eq(eventContacts.contactId, contactId)))
    .get();
  return row ? { ...row.contact, status: row.status } : null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const contactId = Number(params.contactId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const speaker = await loadSpeaker(eventId, contactId);
  if (!speaker) throw new Response("Speaker not found", { status: 404 });

  const sessionRows = await db
    .select({
      id: sessions.id,
      friendlyId: sessions.friendlyId,
      title: sessions.title,
      role: sessionParticipants.role,
      inviteStatus: sessionParticipants.inviteStatus,
      statusKey: statuses.key,
      statusLabel: statuses.label,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      roomName: rooms.name,
    })
    .from(sessionParticipants)
    .innerJoin(sessions, eq(sessionParticipants.sessionId, sessions.id))
    .leftJoin(statuses, eq(sessions.statusId, statuses.id))
    .leftJoin(rooms, eq(sessions.roomId, rooms.id))
    .where(and(eq(sessionParticipants.contactId, contactId), eq(sessions.eventId, eventId)))
    .orderBy(asc(sessions.id))
    .all();

  const matrix = await taskMatrix(eventId);
  const tasks = matrix.tasks
    .filter((task) => task.assignees.includes(contactId))
    .map((task) => {
      const cell = matrix.cells.find((c) => c.taskId === task.id && c.contactId === contactId);
      return { id: task.id, title: task.title, dueAt: task.dueAt, status: cell?.status ?? "todo" };
    });

  const uploads = await db
    .select({
      id: fileUploads.id,
      filename: fileUploads.filename,
      size: fileUploads.size,
      version: fileUploads.version,
      approval: fileUploads.approval,
      createdAt: fileUploads.createdAt,
      requestTitle: fileRequests.title,
      requestId: fileUploads.requestId,
    })
    .from(fileUploads)
    .leftJoin(fileRequests, eq(fileUploads.requestId, fileRequests.id))
    .where(eq(fileUploads.contactId, contactId))
    .orderBy(desc(fileUploads.createdAt))
    .all();

  const emails = await db
    .select({
      id: emailSends.id,
      subject: emailSends.subject,
      status: emailSends.status,
      createdAt: emailSends.createdAt,
      templateKey: emailSends.templateKey,
    })
    .from(emailSends)
    .where(eq(emailSends.toContactId, contactId))
    .orderBy(desc(emailSends.createdAt))
    .limit(25)
    .all();

  const headshotUpload = speaker.headshotBlobKey
    ? await db.select({ id: fileUploads.id }).from(fileUploads).where(eq(fileUploads.blobKey, speaker.headshotBlobKey)).get()
    : null;

  return {
    event,
    speaker,
    sessions: sessionRows,
    tasks,
    uploads,
    emails,
    headshotUploadId: headshotUpload?.id ?? null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const contactId = Number(params.contactId);
  const db = getDb();

  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });
  const speaker = await loadSpeaker(eventId, contactId);
  if (!speaker) throw new Response("Speaker not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "save-profile") {
    const firstName = String(form.get("firstName") ?? "").trim();
    if (!firstName) return { error: "Enter a first name.", notice: null };

    const headshot = form.get("headshot");
    let headshotBlobKey: string | undefined;
    if (headshot instanceof File && headshot.size > 0) {
      if (headshot.size > MAX_HEADSHOT_BYTES) return { error: "That image is larger than 5 MB.", notice: null };
      const key = newBlobKey(`headshot-${contactId}`, headshot.name || "headshot.png");
      await putFile(bindings, key, await headshot.arrayBuffer(), headshot.type || "image/png");
      headshotBlobKey = key;
      await db.insert(fileUploads).values({
        requestId: null,
        eventId,
        contactId,
        sessionId: null,
        version: 1,
        blobKey: key,
        filename: headshot.name || "headshot.png",
        contentType: headshot.type || "image/png",
        size: headshot.size,
        approval: "approved",
        uploadedBy: user.id,
        createdAt: new Date(),
      });
    }

    await db
      .update(contacts)
      .set({
        firstName,
        lastName: String(form.get("lastName") ?? "").trim(),
        title: String(form.get("title") ?? "").trim() || null,
        company: String(form.get("company") ?? "").trim() || null,
        bio: String(form.get("bio") ?? "").trim() || null,
        twitter: String(form.get("twitter") ?? "").trim() || null,
        linkedin: String(form.get("linkedin") ?? "").trim() || null,
        website: String(form.get("website") ?? "").trim() || null,
        phone: String(form.get("phone") ?? "").trim() || null,
        dietary: String(form.get("dietary") ?? "").trim() || null,
        tshirt: String(form.get("tshirt") ?? "").trim() || null,
        travel: String(form.get("travel") ?? "").trim() || null,
        notes: String(form.get("notes") ?? "").trim() || null,
        ...(headshotBlobKey ? { headshotBlobKey } : {}),
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, contactId));

    return { error: null, notice: "Profile saved." };
  }

  if (intent === "set-status") {
    const status = String(form.get("status") ?? "") as SpeakerStatus;
    if (!["invited", "confirmed", "declined"].includes(status)) return { error: "Choose a status.", notice: null };
    await db
      .update(eventContacts)
      .set({ status })
      .where(and(eq(eventContacts.eventId, eventId), eq(eventContacts.contactId, contactId)));
    return { error: null, notice: `Status set to ${SPEAKER_STATUS_LABEL[status]}.` };
  }

  if (intent === "toggle-task") {
    const taskId = Number(form.get("taskId") ?? 0);
    const done = String(form.get("done") ?? "") === "1";
    const existing = await db
      .select({ id: taskCompletions.id })
      .from(taskCompletions)
      .where(and(eq(taskCompletions.taskId, taskId), eq(taskCompletions.contactId, contactId)))
      .get();
    const values = { status: done ? ("done" as const) : ("todo" as const), completedAt: done ? new Date() : null };
    if (existing) await db.update(taskCompletions).set(values).where(eq(taskCompletions.id, existing.id));
    else await db.insert(taskCompletions).values({ taskId, contactId, ...values });
    return { error: null, notice: done ? "Task marked complete." : "Task marked incomplete." };
  }

  if (intent === "invite") {
    const template = await getTemplate(eventId, "portal_invite");
    await queueBulk({
      event,
      templateKey: "portal_invite",
      subject: template.subject,
      body: template.body,
      recipients: [
        {
          person: {
            contactId,
            name: `${speaker.firstName} ${speaker.lastName}`.trim() || speaker.email,
            firstName: speaker.firstName,
            email: speaker.email,
          },
        },
      ],
    });
    return { error: null, notice: `Portal invite queued for ${speaker.email}. See Communications.` };
  }

  return { error: null, notice: null };
}

export default function SpeakerDetail({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, speaker, sessions: sessionRows, tasks, uploads, emails, headshotUploadId } = loaderData;
  const base = `/admin/${params.eventId}`;
  const name = `${speaker.firstName} ${speaker.lastName}`.trim() || speaker.email;

  return (
    <>
      <Breadcrumbs items={[{ to: `${base}/speakers`, label: "Speakers" }, { label: name }]} />

      <PageHeader
        title={name}
        description={[speaker.title, speaker.company].filter(Boolean).join(", ") || speaker.email}
        actions={
          <Form method="post">
            <button type="submit" name="intent" value="invite" className={buttonSecondary}>
              Send portal invite
            </button>
          </Form>
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Profile</h2>
            <Form method="post" encType="multipart/form-data" className="mt-3 space-y-4">
              <input type="hidden" name="intent" value="save-profile" />

              <div className="flex items-start gap-4">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  {headshotUploadId ? (
                    <img src={`/files/${headshotUploadId}?inline=1`} alt={`Headshot of ${name}`} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-xs text-slate-400">No photo</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Field label="Headshot" name="headshot" help="PNG, JPEG, or WebP, up to 5 MB.">
                    <input
                      id="headshot"
                      name="headshot"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="block w-full text-sm text-slate-900 file:mr-3 file:h-9 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-900"
                    />
                  </Field>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" name="firstName" required>
                  <input id="firstName" name="firstName" defaultValue={speaker.firstName} className={inputClass} required />
                </Field>
                <Field label="Last name" name="lastName">
                  <input id="lastName" name="lastName" defaultValue={speaker.lastName} className={inputClass} />
                </Field>
                <Field label="Job title" name="title">
                  <input id="title" name="title" defaultValue={speaker.title ?? ""} className={inputClass} />
                </Field>
                <Field label="Company" name="company">
                  <input id="company" name="company" defaultValue={speaker.company ?? ""} className={inputClass} />
                </Field>
              </div>

              <Field label="Bio" name="bio">
                <textarea id="bio" name="bio" rows={6} defaultValue={speaker.bio ?? ""} className={textareaClass} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Twitter" name="twitter">
                  <input id="twitter" name="twitter" defaultValue={speaker.twitter ?? ""} className={inputClass} />
                </Field>
                <Field label="LinkedIn" name="linkedin">
                  <input id="linkedin" name="linkedin" defaultValue={speaker.linkedin ?? ""} className={inputClass} />
                </Field>
                <Field label="Website" name="website">
                  <input id="website" name="website" defaultValue={speaker.website ?? ""} className={inputClass} />
                </Field>
                <Field label="Phone" name="phone">
                  <input id="phone" name="phone" defaultValue={speaker.phone ?? ""} className={inputClass} />
                </Field>
                <Field label="Dietary requirements" name="dietary">
                  <input id="dietary" name="dietary" defaultValue={speaker.dietary ?? ""} className={inputClass} />
                </Field>
                <Field label="T-shirt size" name="tshirt">
                  <input id="tshirt" name="tshirt" defaultValue={speaker.tshirt ?? ""} className={inputClass} />
                </Field>
              </div>

              <Field label="Travel and logistics" name="travel" help="Arrival and departure, seating, accessibility needs.">
                <textarea id="travel" name="travel" rows={3} defaultValue={speaker.travel ?? ""} className={textareaClass} />
              </Field>

              <Field label="Internal notes" name="notes" help="Not visible to the speaker.">
                <textarea id="notes" name="notes" rows={3} defaultValue={speaker.notes ?? ""} className={textareaClass} />
              </Field>

              <button type="submit" className={buttonPrimary}>
                Save profile
              </button>
            </Form>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Tasks</h2>
            {tasks.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                No tasks apply to this speaker.{" "}
                <Link to={`${base}/portals`} className="font-medium text-accent hover:underline">
                  Manage tasks
                </Link>
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {tasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <p className="text-sm text-slate-900">{task.title}</p>
                      <p className="text-[13px] text-slate-500">
                        {task.dueAt ? `Due ${formatDate(task.dueAt, event.timezone)}` : "No due date"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <TaskBadge status={task.status} />
                      <Form method="post">
                        <input type="hidden" name="intent" value="toggle-task" />
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="done" value={task.status === "done" ? "0" : "1"} />
                        <button type="submit" className={buttonSecondary}>
                          {task.status === "done" ? "Mark incomplete" : "Mark complete"}
                        </button>
                      </Form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Files</h2>
            {uploads.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Nothing uploaded yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {uploads.map((upload) => (
                  <li key={upload.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="text-sm">
                        <a href={`/files/${upload.id}`} className="font-medium text-accent hover:underline">
                          {upload.filename}
                        </a>
                        <span className="ml-2 text-slate-500">
                          v{upload.version}, {formatBytes(upload.size)}
                        </span>
                      </p>
                      <p className="text-[13px] text-slate-500">
                        {upload.requestTitle ?? "Profile photo"}, uploaded {formatDateTime(upload.createdAt, event.timezone)} by {name}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <ApprovalBadge approval={upload.approval} />
                      <Link to={`${base}/content/uploads/${upload.id}`} className={buttonSecondary}>
                        Review
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Roster status</h2>
            <p className="mt-1 text-sm text-slate-900">{SPEAKER_STATUS_LABEL[speaker.status]}</p>
            <Form method="post" className="mt-3 flex items-center gap-2">
              <input type="hidden" name="intent" value="set-status" />
              <select name="status" defaultValue={speaker.status} aria-label="Set status" className={selectClass}>
                <option value="invited">Invited</option>
                <option value="confirmed">Confirmed</option>
                <option value="declined">Declined</option>
              </select>
              <button type="submit" className={buttonPrimary}>
                Save
              </button>
            </Form>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Sessions</h2>
            {sessionRows.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Not linked to any session yet.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {sessionRows.map((session) => (
                  <li key={session.id}>
                    <Link
                      to={`${base}/submissions/${session.id}`}
                      className="text-sm font-medium text-slate-900 hover:text-accent"
                    >
                      {session.title}
                    </Link>
                    <p className="text-[13px] text-slate-500">
                      {session.friendlyId}, {ROLE_LABEL[session.role] ?? session.role}
                      {session.statusLabel ? `, ${session.statusLabel}` : ""}
                    </p>
                    <p className="text-[13px] text-slate-500">
                      {session.startsAt
                        ? `${formatDate(session.startsAt, event.timezone)}, ${formatTimeOfDay(session.startsAt, event.timezone)}${
                            session.roomName ? `, ${session.roomName}` : ""
                          }`
                        : "Not scheduled"}
                    </p>
                    <p className="text-[13px] text-slate-500">Participation: {session.inviteStatus}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Email history</h2>
            {emails.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No emails sent to this speaker yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {emails.map((email) => (
                  <li key={email.id} className="py-2">
                    <p className="text-[13px] font-medium text-slate-900">{email.subject}</p>
                    <p className="text-[13px] text-slate-500">
                      {formatDateTime(email.createdAt, event.timezone)}, {email.status}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Link to={`${base}/communications`} className={`${buttonSecondary} mt-3`}>
              Open Communications
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
