// Manual submission entry for organizers: a talk that arrived by email or a hallway
// promise still gets a row in the pipeline.

import { Form, Link, redirect } from "react-router";
import { asc, eq } from "drizzle-orm";
import type { Route } from "./+types/event.submission.new";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { nextFriendlyId } from "../lib/cfp.server";
import { findOrCreateContact } from "../lib/users.server";
import { eventContacts, events, formats, forms, levels, sessionParticipants, sessions, statuses, tracks } from "../../database/schema";
import { Card, ErrorSummary, Field, PageHeader, buttonPrimary, buttonSecondary, inputClass, selectClass, textareaClass } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Add submission" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  return {
    event,
    tracks: await db.select({ id: tracks.id, name: tracks.name }).from(tracks).where(eq(tracks.eventId, eventId)).orderBy(asc(tracks.sort)).all(),
    formats: await db.select({ id: formats.id, name: formats.name }).from(formats).where(eq(formats.eventId, eventId)).orderBy(asc(formats.sort)).all(),
    levels: await db.select({ id: levels.id, name: levels.name }).from(levels).where(eq(levels.eventId, eventId)).orderBy(asc(levels.sort)).all(),
    statuses: await db
      .select({ id: statuses.id, key: statuses.key, label: statuses.label })
      .from(statuses)
      .where(eq(statuses.eventId, eventId))
      .orderBy(asc(statuses.sort))
      .all(),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const form = await request.formData();

  const title = String(form.get("title") ?? "").trim();
  const speakerName = String(form.get("speakerName") ?? "").trim();
  const speakerEmail = String(form.get("speakerEmail") ?? "").trim().toLowerCase();

  const errors: Record<string, string> = {};
  if (!title) errors.title = "Enter a session title.";
  if (!speakerName) errors.speakerName = "Enter the speaker's name.";
  if (!speakerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(speakerEmail)) errors.speakerEmail = "Enter a valid speaker email.";
  if (Object.keys(errors).length > 0) return { errors };

  const abstract = String(form.get("abstract") ?? "").trim();
  const trackId = Number(form.get("trackId") ?? 0) || null;
  const formatId = Number(form.get("formatId") ?? 0) || null;
  const levelId = Number(form.get("levelId") ?? 0) || null;
  const statusId = Number(form.get("statusId") ?? 0) || null;

  const status = statusId
    ? await db.select({ id: statuses.id, key: statuses.key }).from(statuses).where(eq(statuses.id, statusId)).get()
    : null;

  const contactId = await findOrCreateContact({
    email: speakerEmail,
    name: speakerName,
    company: String(form.get("speakerCompany") ?? "").trim() || null,
    bio: String(form.get("speakerBio") ?? "").trim() || null,
  });

  // Attach to the event's primary form so the detail view renders labeled answers.
  const primaryForm = await db
    .select({ id: forms.id })
    .from(forms)
    .where(eq(forms.eventId, eventId))
    .orderBy(asc(forms.createdAt))
    .get();

  const trackName = trackId
    ? (await db.select({ name: tracks.name }).from(tracks).where(eq(tracks.id, trackId)).get())?.name
    : undefined;
  const formatName = formatId
    ? (await db.select({ name: formats.name }).from(formats).where(eq(formats.id, formatId)).get())?.name
    : undefined;
  const levelName = levelId
    ? (await db.select({ name: levels.name }).from(levels).where(eq(levels.id, levelId)).get())?.name
    : undefined;

  const answers: Record<string, string> = { title, abstract };
  if (trackName) answers.track = trackName;
  if (formatName) answers.format = formatName;
  if (levelName) answers.audience_level = levelName;

  const now = new Date();
  const created = await db
    .insert(sessions)
    .values({
      eventId,
      friendlyId: await nextFriendlyId(),
      title,
      abstract: abstract || null,
      isAbstract: status?.key !== "accepted",
      isDraft: false,
      statusId,
      formId: primaryForm?.id ?? null,
      submittedBy: contactId,
      trackId,
      formatId,
      levelId,
      answersJson: JSON.stringify(answers),
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: sessions.id })
    .get();

  await db.insert(sessionParticipants).values({ sessionId: created.id, contactId, role: "speaker", sort: 0 });
  await db.insert(eventContacts).values({ eventId, contactId, kind: "speaker" }).onConflictDoNothing();

  throw redirect(`/admin/${eventId}/submissions/${created.id}`);
}

export default function NewSubmission({ loaderData, actionData, params }: Route.ComponentProps) {
  const { tracks: trackRows, formats: formatRows, levels: levelRows, statuses: statusRows } = loaderData;
  const errors = actionData?.errors ?? {};

  return (
    <>
      <div className="mb-2 text-[13px]">
        <Link to={`/admin/${params.eventId}/submissions`} className="text-slate-500 hover:text-slate-900">
          Submissions
        </Link>
        <span className="mx-1 text-slate-400">/</span>
        <span className="text-slate-900">Add submission</span>
      </div>

      <PageHeader title="Add submission" description="Enter a proposal on a speaker's behalf. It joins the pipeline like any other." />

      <Card className="max-w-[640px] p-4">
        <Form method="post" noValidate className="space-y-4">
          <ErrorSummary errors={errors} />

          <Field label="Session title" name="title" required error={errors.title}>
            <input id="title" name="title" className={inputClass} required />
          </Field>

          <Field label="Abstract" name="abstract">
            <textarea id="abstract" name="abstract" rows={5} className={textareaClass} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Track" name="trackId">
              <select id="trackId" name="trackId" className={selectClass}>
                <option value="">No track</option>
                {trackRows.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format" name="formatId">
              <select id="formatId" name="formatId" className={selectClass}>
                <option value="">No format</option>
                {formatRows.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Audience level" name="levelId">
              <select id="levelId" name="levelId" className={selectClass}>
                <option value="">Not set</option>
                {levelRows.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status" name="statusId">
              <select id="statusId" name="statusId" defaultValue={statusRows.find((s) => s.key === "pending")?.id} className={selectClass}>
                {statusRows.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h2 className="text-sm font-semibold text-slate-900">Speaker</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="speakerName" required error={errors.speakerName}>
              <input id="speakerName" name="speakerName" className={inputClass} required />
            </Field>
            <Field label="Email" name="speakerEmail" required error={errors.speakerEmail}>
              <input id="speakerEmail" name="speakerEmail" type="email" className={inputClass} required />
            </Field>
          </div>
          <Field label="Company" name="speakerCompany">
            <input id="speakerCompany" name="speakerCompany" className={inputClass} />
          </Field>
          <Field label="Bio" name="speakerBio">
            <textarea id="speakerBio" name="speakerBio" rows={3} className={textareaClass} />
          </Field>

          <div className="flex items-center gap-2">
            <button type="submit" className={buttonPrimary}>
              Add submission
            </button>
            <Link to={`/admin/${params.eventId}/submissions`} className={buttonSecondary}>
              Cancel
            </Link>
          </div>
        </Form>
      </Card>
    </>
  );
}
