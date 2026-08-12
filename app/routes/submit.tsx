// The public CFP portal: /submit/:eventSlug/:formSlug
//
// Logged out it shows the event, the deadline, a live preview of the form (so the
// conditional logic and dropdown options are visible without an account), and inline
// signup/login. Logged in it runs the multi-step submission flow: session details,
// speakers, review. Drafts save and resume. Every mutation re-checks the open window
// server-side: a closed form rejects the POST no matter what the page showed.

import { useState, type ReactNode } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/submit";
import { appBaseUrl, bindings, getDb, sessionSecret } from "../lib/db.server";
import { createSessionCookie, verifyPassword } from "../lib/auth";
import { getUser } from "../lib/session.server";
import { createAccount, findOrCreateContact } from "../lib/users.server";
import {
  formOpenState,
  getFields,
  getStatusByKey,
  loadPublicForm,
  nextFriendlyId,
  validateRequired,
  visibleFields,
  withColumnFallbacks,
  type FieldDef,
} from "../lib/cfp.server";
import { sendEmail, renderTemplate } from "../lib/email";
import { newBlobKey, putFile } from "../lib/storage";
import { daysUntil, formatDate, formatDateRange } from "../lib/format";
import {
  contacts,
  eventContacts,
  fileUploads,
  formats,
  levels,
  sessionParticipants,
  sessions,
  tracks,
  users,
} from "../../database/schema";
import { ErrorSummary, PublicHeader } from "../components/ui";
import { ROLE_LABEL } from "../lib/labels";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData?.event) return [{ title: "Call for papers" }];
  return [
    { title: `${loaderData.form.name} | ${loaderData.event.name}` },
    { name: "description", content: `Submit your abstract to ${loaderData.event.name}.` },
  ];
}

// Speaker-section fields whose answers live on the contact record, not the session.
const CONTACT_FIELD_KEYS = new Set(["bio", "company", "title", "dietary", "tshirt", "phone", "twitter", "linkedin", "website"]);

const PARTICIPANT_ROLES: { value: "co_speaker" | "panelist" | "moderator"; label: string }[] = [
  { value: "co_speaker", label: "Co-speaker" },
  { value: "panelist", label: "Panelist" },
  { value: "moderator", label: "Moderator" },
];

function parseAnswers(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const loaded = await loadPublicForm(params.eventSlug, params.formSlug);
  if (!loaded) throw new Response("Form not found", { status: 404 });
  const { event, form } = loaded;

  const state = formOpenState(form);
  const user = await getUser(request);
  const fields = await getFields(form.id, event.id);

  const url = new URL(request.url);
  const sid = Number(url.searchParams.get("sid") ?? 0) || null;
  const step = Math.min(3, Math.max(1, Number(url.searchParams.get("step") ?? 1) || 1));
  const done = url.searchParams.get("done") === "1";

  const db = getDb();
  let contact: { id: number; email: string; firstName: string; lastName: string } | null = null;
  let mySubmissions: { id: number; title: string; friendlyId: string; isDraft: boolean; updatedAt: Date }[] = [];
  let current: {
    id: number;
    title: string;
    friendlyId: string;
    isDraft: boolean;
    answers: Record<string, string>;
    submittedAt: Date | null;
  } | null = null;
  let participants: { id: number; role: string; name: string; email: string; title: string | null; company: string | null }[] = [];
  let contactValues: Record<string, string> = {};

  if (user?.contactId) {
    const row = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, user.contactId))
      .get();
    if (row) {
      contact = { id: row.id, email: row.email, firstName: row.firstName, lastName: row.lastName };
      contactValues = {
        bio: row.bio ?? "",
        company: row.company ?? "",
        title: row.title ?? "",
        dietary: row.dietary ?? "",
        tshirt: row.tshirt ?? "",
        phone: row.phone ?? "",
        twitter: row.twitter ?? "",
        linkedin: row.linkedin ?? "",
        website: row.website ?? "",
      };

      mySubmissions = (
        await db
          .select({
            id: sessions.id,
            title: sessions.title,
            friendlyId: sessions.friendlyId,
            isDraft: sessions.isDraft,
            updatedAt: sessions.updatedAt,
          })
          .from(sessions)
          .where(and(eq(sessions.formId, form.id), eq(sessions.submittedBy, row.id)))
          .orderBy(asc(sessions.createdAt))
          .all()
      ).map((s) => ({ ...s }));

      if (sid) {
        const mine = mySubmissions.find((s) => s.id === sid);
        if (mine) {
          const sessionRow = await db.select().from(sessions).where(eq(sessions.id, sid)).get();
          if (sessionRow) {
            const trackRow = sessionRow.trackId
              ? await db.select({ name: tracks.name }).from(tracks).where(eq(tracks.id, sessionRow.trackId)).get()
              : null;
            const formatRow = sessionRow.formatId
              ? await db.select({ name: formats.name }).from(formats).where(eq(formats.id, sessionRow.formatId)).get()
              : null;
            const levelRow = sessionRow.levelId
              ? await db.select({ name: levels.name }).from(levels).where(eq(levels.id, sessionRow.levelId)).get()
              : null;
            current = {
              id: sessionRow.id,
              title: sessionRow.title,
              friendlyId: sessionRow.friendlyId,
              isDraft: sessionRow.isDraft,
              answers: withColumnFallbacks(parseAnswers(sessionRow.answersJson), sessionRow, {
                track: trackRow?.name,
                format: formatRow?.name,
                level: levelRow?.name,
              }),
              submittedAt: sessionRow.submittedAt,
            };
            const pRows = await db
              .select({
                id: sessionParticipants.id,
                role: sessionParticipants.role,
                sort: sessionParticipants.sort,
                name: contacts.firstName,
                lastName: contacts.lastName,
                email: contacts.email,
                title: contacts.title,
                company: contacts.company,
              })
              .from(sessionParticipants)
              .leftJoin(contacts, eq(sessionParticipants.contactId, contacts.id))
              .where(eq(sessionParticipants.sessionId, sid))
              .orderBy(asc(sessionParticipants.sort), asc(sessionParticipants.id))
              .all();
            participants = pRows.map((p) => ({
              id: p.id,
              role: p.role,
              name: `${p.name ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "Unknown",
              email: p.email ?? "",
              title: p.title,
              company: p.company,
            }));
          }
        }
      }
    }
  }

  const draft = mySubmissions.find((s) => s.isDraft) ?? null;
  const submittedCount = mySubmissions.filter((s) => !s.isDraft).length;
  const limitReached = form.submissionLimit != null && submittedCount >= form.submissionLimit;

  return {
    event,
    form: {
      id: form.id,
      name: form.name,
      slug: form.slug,
      welcomeHtml: form.welcomeHtml,
      thankYouHtml: form.thankYouHtml,
      opensAt: form.opensAt,
      closesAt: form.closesAt,
      submissionLimit: form.submissionLimit,
      maxSpeakers: form.maxSpeakers,
      allowDrafts: form.allowDrafts,
      allowEditAfterSubmit: form.allowEditAfterSubmit,
    },
    state,
    fields,
    user,
    contact,
    contactValues,
    mySubmissions,
    draft: draft ? { id: draft.id, title: draft.title, updatedAt: draft.updatedAt } : null,
    limitReached,
    submittedCount,
    current,
    participants,
    sid,
    step,
    done,
    portalUrl: `${appBaseUrl()}/portal`,
  };
}

// ---------------- action ----------------

interface ActionResult {
  errors?: Record<string, string>;
  authErrors?: Record<string, string>;
  authMode?: "signup" | "login";
  authValues?: { name?: string; email?: string };
  notice?: string;
  formError?: string;
}

function closedMessage(closesAt: Date | null, timezone: string): string {
  return closesAt
    ? `This form closed ${formatDate(closesAt, timezone)}. It no longer accepts submissions.`
    : "This form is closed. It no longer accepts submissions.";
}

export async function action({ request, params }: Route.ActionArgs): Promise<Response | ActionResult> {
  const loaded = await loadPublicForm(params.eventSlug, params.formSlug);
  if (!loaded) throw new Response("Form not found", { status: 404 });
  const { event, form } = loaded;

  const db = getDb();
  const url = new URL(request.url);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const selfUrl = `/submit/${params.eventSlug}/${params.formSlug}`;

  // ---- inline auth (allowed regardless of open state) ----
  if (intent === "auth-signup") {
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const authErrors: Record<string, string> = {};
    if (!name) authErrors.name = "Enter your name.";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) authErrors.email = "Enter a valid email address.";
    if (password.length < 8) authErrors.password = "Use at least 8 characters.";
    if (Object.keys(authErrors).length > 0) return { authErrors, authMode: "signup", authValues: { name, email } };

    const result = await createAccount({ name, email, password, role: "speaker" });
    if ("error" in result) return { authErrors: { email: `${result.error} Sign in instead.` }, authMode: "signup", authValues: { name, email } };

    return redirect(selfUrl, {
      headers: { "Set-Cookie": await createSessionCookie({ userId: result.userId, role: "speaker" }, sessionSecret()) },
    });
  }

  if (intent === "auth-login") {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    const userRow = await db
      .select({ id: users.id, role: users.role, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .get();
    const ok = userRow ? await verifyPassword(password, userRow.passwordHash) : false;
    if (!userRow || !ok) {
      return { authErrors: { password: "That email and password do not match an account." }, authMode: "login", authValues: { email } };
    }
    return redirect(selfUrl, {
      headers: { "Set-Cookie": await createSessionCookie({ userId: userRow.id, role: userRow.role }, sessionSecret()) },
    });
  }

  // ---- everything else needs a signed-in user ----
  const user = await getUser(request);
  if (!user) return { formError: "Sign in to continue." };

  const state = formOpenState(form);
  if (state !== "open") {
    return { formError: state === "closed" ? closedMessage(form.closesAt, event.timezone) : "This form is not open yet." };
  }

  // Every signed-in submitter needs a contact row.
  let contactId = user.contactId;
  if (!contactId) {
    contactId = await findOrCreateContact({ email: user.email, name: user.name });
    await db.update(users).set({ contactId }).where(eq(users.id, user.id));
  }

  const fields = await getFields(form.id, event.id);
  const now = new Date();

  if (intent === "start") {
    const mine = await db
      .select({ id: sessions.id, isDraft: sessions.isDraft })
      .from(sessions)
      .where(and(eq(sessions.formId, form.id), eq(sessions.submittedBy, contactId)))
      .all();

    const existingDraft = mine.find((s) => s.isDraft);
    if (existingDraft) return redirect(`${selfUrl}?sid=${existingDraft.id}&step=1`);

    const submittedCount = mine.filter((s) => !s.isDraft).length;
    if (form.submissionLimit != null && submittedCount >= form.submissionLimit) {
      return {
        formError: `You have reached the limit of ${form.submissionLimit} ${form.submissionLimit === 1 ? "submission" : "submissions"} for this form.`,
      };
    }

    const created = await db
      .insert(sessions)
      .values({
        eventId: event.id,
        friendlyId: await nextFriendlyId(),
        title: "",
        isAbstract: true,
        isDraft: true,
        formId: form.id,
        submittedBy: contactId,
        answersJson: "{}",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: sessions.id })
      .get();
    await db.insert(sessionParticipants).values({ sessionId: created.id, contactId, role: "speaker", sort: 0 });
    return redirect(`${selfUrl}?sid=${created.id}&step=1`);
  }

  // Remaining intents operate on an owned submission.
  const sid = Number(formData.get("sid") ?? 0);
  const session = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sid), eq(sessions.formId, form.id), eq(sessions.submittedBy, contactId)))
    .get();
  if (!session) return { formError: "That submission no longer exists." };

  if (!session.isDraft && !form.allowEditAfterSubmit && intent !== "reset-draft") {
    return { formError: "Editing after submitting is not enabled for this form." };
  }

  const answers = parseAnswers(session.answersJson);

  if (intent === "reset-draft") {
    if (!session.isDraft) return { formError: "Only drafts can be reset." };
    await db.delete(sessionParticipants).where(eq(sessionParticipants.sessionId, session.id));
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return redirect(selfUrl);
  }

  if (intent === "save-session" || intent === "save-draft") {
    const sessionFields = fields.filter((f) => f.section === "session");

    // First pass: raw values for every session field, so conditional visibility can
    // be evaluated against what was just entered.
    for (const field of sessionFields) {
      if (field.type === "file") {
        const file = formData.get(field.fieldKey);
        if (file instanceof File && file.size > 0) {
          if (file.size > 5 * 1024 * 1024) {
            return { errors: { [field.fieldKey]: `${field.label}: files must be under 5 MB.` } };
          }
          const key = newBlobKey(`form-${form.id}`, file.name);
          await putFile(bindings, key, await file.arrayBuffer(), file.type || "application/octet-stream");
          const versions = await db
            .select({ version: fileUploads.version })
            .from(fileUploads)
            .where(eq(fileUploads.sessionId, session.id))
            .all();
          await db.insert(fileUploads).values({
            eventId: event.id,
            contactId,
            sessionId: session.id,
            version: versions.reduce((max, v) => Math.max(max, v.version), 0) + 1,
            blobKey: key,
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            uploadedBy: user.id,
            createdAt: now,
          });
          answers[field.fieldKey] = file.name;
        }
        continue;
      }
      if (field.type === "multiselect") {
        answers[field.fieldKey] = formData
          .getAll(field.fieldKey)
          .map(String)
          .filter(Boolean)
          .join(", ");
        continue;
      }
      if (field.type === "checkbox") {
        answers[field.fieldKey] = formData.get(field.fieldKey) === "on" ? "Yes" : "";
        continue;
      }
      answers[field.fieldKey] = String(formData.get(field.fieldKey) ?? "").trim();
    }

    // Hidden conditional fields do not keep stale answers.
    const visible = visibleFields(sessionFields, answers);
    const visibleKeys = new Set(visible.map((f) => f.fieldKey));
    for (const field of sessionFields) {
      if (field.conditional && !visibleKeys.has(field.fieldKey)) answers[field.fieldKey] = "";
    }

    const title = (answers.title ?? "").trim();

    if (intent === "save-draft") {
      if (!title) return { errors: { title: "Enter a title to save a draft." } };
    } else {
      const errors = validateRequired(visible, answers);
      if (Object.keys(errors).length > 0) return { errors };
    }

    const taxonomy = await mapTaxonomy(event.id, answers);
    await db
      .update(sessions)
      .set({
        title,
        abstract: (answers.abstract ?? "").trim() || null,
        answersJson: JSON.stringify(answers),
        ...taxonomy,
        updatedAt: now,
      })
      .where(eq(sessions.id, session.id));

    if (intent === "save-draft") {
      return { notice: "Draft saved. You can leave and finish later." };
    }
    return redirect(`${selfUrl}?sid=${session.id}&step=2`);
  }

  if (intent === "save-speaker") {
    const speakerFields = fields.filter((f) => f.section === "speaker");
    for (const field of speakerFields) {
      if (field.type === "file") continue; // speaker files arrive via the portal in a later phase
      if (field.type === "multiselect") {
        answers[field.fieldKey] = formData.getAll(field.fieldKey).map(String).filter(Boolean).join(", ");
      } else if (field.type === "checkbox") {
        answers[field.fieldKey] = formData.get(field.fieldKey) === "on" ? "Yes" : "";
      } else {
        answers[field.fieldKey] = String(formData.get(field.fieldKey) ?? "").trim();
      }
    }

    const visible = visibleFields(speakerFields, answers);
    const errors = validateRequired(visible, answers);
    if (Object.keys(errors).length > 0) return { errors };

    // Profile-shaped answers update the contact so the speaker CRM stays current.
    const contactPatch: Record<string, string | null> = {};
    for (const field of visible) {
      if (CONTACT_FIELD_KEYS.has(field.fieldKey)) {
        contactPatch[field.fieldKey] = (answers[field.fieldKey] ?? "").trim() || null;
      }
    }
    if (Object.keys(contactPatch).length > 0) {
      await db
        .update(contacts)
        .set({ ...contactPatch, updatedAt: now })
        .where(eq(contacts.id, contactId));
    }

    await db.update(sessions).set({ answersJson: JSON.stringify(answers), updatedAt: now }).where(eq(sessions.id, session.id));
    return redirect(`${selfUrl}?sid=${session.id}&step=3`);
  }

  if (intent === "add-cospeaker") {
    const name = String(formData.get("coName") ?? "").trim();
    const email = String(formData.get("coEmail") ?? "").trim().toLowerCase();
    const role = String(formData.get("coRole") ?? "co_speaker");
    if (!name || !email) return { errors: { coName: "Enter the co-speaker's name and email." } };

    const existing = await db
      .select({ id: sessionParticipants.id, contactId: sessionParticipants.contactId, sort: sessionParticipants.sort })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, session.id))
      .all();
    if (existing.length >= form.maxSpeakers) {
      return { errors: { coName: `This form allows at most ${form.maxSpeakers} speakers per submission.` } };
    }

    const coContactId = await findOrCreateContact({
      email,
      name,
      title: String(formData.get("coTitle") ?? "").trim() || null,
      company: String(formData.get("coCompany") ?? "").trim() || null,
      bio: String(formData.get("coBio") ?? "").trim() || null,
    });
    if (existing.some((p) => p.contactId === coContactId)) {
      return { errors: { coName: "That person is already on this submission." } };
    }

    const validRole = PARTICIPANT_ROLES.some((r) => r.value === role) ? (role as "co_speaker" | "panelist" | "moderator") : "co_speaker";
    await db.insert(sessionParticipants).values({
      sessionId: session.id,
      contactId: coContactId,
      role: validRole,
      sort: existing.reduce((max, p) => Math.max(max, p.sort), 0) + 1,
    });
    return redirect(`${selfUrl}?sid=${session.id}&step=2`);
  }

  if (intent === "remove-cospeaker") {
    const participantId = Number(formData.get("participantId") ?? 0);
    const row = await db
      .select({ id: sessionParticipants.id, contactId: sessionParticipants.contactId })
      .from(sessionParticipants)
      .where(and(eq(sessionParticipants.id, participantId), eq(sessionParticipants.sessionId, session.id)))
      .get();
    if (row && row.contactId !== contactId) {
      await db.delete(sessionParticipants).where(eq(sessionParticipants.id, row.id));
    }
    return redirect(`${selfUrl}?sid=${session.id}&step=2`);
  }

  if (intent === "submit") {
    const allVisible = visibleFields(fields, answers);
    const errors = validateRequired(allVisible, answers);
    if (Object.keys(errors).length > 0) {
      return { errors, formError: "Some required answers are missing. Check the earlier steps." };
    }

    const firstSubmit = session.isDraft;
    const pendingStatus = await getStatusByKey(event.id, "pending");

    await db
      .update(sessions)
      .set({
        isDraft: false,
        statusId: session.statusId ?? pendingStatus?.id ?? null,
        submittedAt: session.submittedAt ?? now,
        updatedAt: now,
      })
      .where(eq(sessions.id, session.id));

    const allParticipants = await db
      .select({ contactId: sessionParticipants.contactId })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, session.id))
      .all();
    for (const p of allParticipants) {
      await db
        .insert(eventContacts)
        .values({ eventId: event.id, contactId: p.contactId, kind: "speaker" })
        .onConflictDoNothing();
    }

    if (firstSubmit) {
      const contactRow = await db.select().from(contacts).where(eq(contacts.id, contactId)).get();
      const vars = {
        speaker_name: `${contactRow?.firstName ?? ""} ${contactRow?.lastName ?? ""}`.trim() || user.name,
        talk_title: session.title || (answers.title ?? ""),
        event_name: event.name,
        portal_url: `${appBaseUrl()}/portal`,
      };
      await sendEmail(bindings, {
        eventId: event.id,
        templateKey: "confirmation",
        toEmail: contactRow?.email ?? user.email,
        toContactId: contactId,
        toName: vars.speaker_name,
        subject: renderTemplate(form.confirmationSubject || "We received your proposal for {event_name}", vars),
        bodyHtml: renderTemplate(
          form.confirmationBody ||
            '<p>Hi {speaker_name},</p><p>We received your proposal "{talk_title}" for {event_name}.</p><p>{portal_url}</p>',
          vars
        ),
      });
    }

    if (firstSubmit) return redirect(`${selfUrl}?sid=${session.id}&done=1`);
    return redirect(`/portal/submissions/${session.id}?saved=1`);
  }

  return { formError: "Unknown action." };
}

async function mapTaxonomy(
  eventId: number,
  answers: Record<string, string>
): Promise<{ trackId: number | null; formatId: number | null; levelId: number | null }> {
  const db = getDb();
  const [trackRows, formatRows, levelRows] = [
    await db.select({ id: tracks.id, name: tracks.name }).from(tracks).where(eq(tracks.eventId, eventId)).all(),
    await db.select({ id: formats.id, name: formats.name }).from(formats).where(eq(formats.eventId, eventId)).all(),
    await db.select({ id: levels.id, name: levels.name }).from(levels).where(eq(levels.eventId, eventId)).all(),
  ];
  return {
    trackId: trackRows.find((t) => t.name === (answers.track ?? ""))?.id ?? null,
    formatId: formatRows.find((f) => f.name === (answers.format ?? ""))?.id ?? null,
    levelId: levelRows.find((l) => l.name === (answers.audience_level ?? ""))?.id ?? null,
  };
}

// ---------------- component ----------------

const publicInput =
  "h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-accent";
const publicTextarea =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-base leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-accent";
const publicPrimary =
  "inline-flex h-11 items-center justify-center rounded-md bg-accent px-4 text-base font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50";
const publicSecondary =
  "inline-flex h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-base font-medium text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-50";

function PublicFieldInput({
  field,
  defaultValue,
  error,
  controlled,
}: {
  field: FieldDef;
  defaultValue: string;
  error?: string;
  controlled?: { value: string; onChange: (value: string) => void };
}) {
  const id = `f-${field.fieldKey}`;
  const common = { id, name: field.fieldKey, "aria-invalid": error ? true : undefined };

  let input;
  if (field.type === "textarea") {
    input = <textarea {...common} rows={5} defaultValue={defaultValue} className={publicTextarea} />;
  } else if (field.type === "select") {
    input = controlled ? (
      <select {...common} value={controlled.value} onChange={(e) => controlled.onChange(e.target.value)} className={publicInput}>
        <option value="">Choose an option</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    ) : (
      <select {...common} defaultValue={defaultValue} className={publicInput}>
        <option value="">Choose an option</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "radio") {
    input = (
      <div className="space-y-2">
        {field.options.map((option) => (
          <label key={option} className="flex min-h-[28px] items-center gap-2.5 text-base text-slate-900">
            <input
              type="radio"
              name={field.fieldKey}
              value={option}
              checked={controlled ? controlled.value === option : undefined}
              defaultChecked={controlled ? undefined : defaultValue === option}
              onChange={controlled ? () => controlled.onChange(option) : undefined}
              className="accent-accent"
            />
            {option}
          </label>
        ))}
      </div>
    );
  } else if (field.type === "multiselect") {
    const chosen = new Set(defaultValue.split(", ").filter(Boolean));
    input = (
      <div className="space-y-2">
        {field.options.map((option) => (
          <label key={option} className="flex min-h-[28px] items-center gap-2.5 text-base text-slate-900">
            <input type="checkbox" name={field.fieldKey} value={option} defaultChecked={chosen.has(option)} className="accent-accent" />
            {option}
          </label>
        ))}
      </div>
    );
  } else if (field.type === "checkbox") {
    input = (
      <label className="flex min-h-[28px] items-center gap-2.5 text-base text-slate-900">
        <input type="checkbox" name={field.fieldKey} defaultChecked={defaultValue === "Yes"} className="accent-accent" />
        Yes
      </label>
    );
  } else if (field.type === "file") {
    input = (
      <div className="space-y-1">
        {defaultValue ? <p className="text-sm text-slate-500">Uploaded: {defaultValue}. Choose a file to replace it.</p> : null}
        <input {...common} type="file" className="block w-full text-base text-slate-900 file:mr-3 file:h-11 file:cursor-pointer file:rounded-md file:border-0 file:bg-slate-100 file:px-4 file:text-base file:font-medium file:text-slate-900 hover:file:bg-slate-200" />
      </div>
    );
  } else {
    const typeAttr = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text";
    input = <input {...common} type={typeAttr} defaultValue={defaultValue} className={publicInput} />;
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-base font-medium text-slate-900">
        {field.label}
        {field.required ? <span className="ml-0.5 text-slate-500">*</span> : null}
      </label>
      {input}
      {field.helpText ? <p className="text-sm leading-snug text-slate-500">{field.helpText}</p> : null}
      {error ? <p className="text-sm leading-snug text-rose-600">{error}</p> : null}
    </div>
  );
}

/** Renders a list of fields with live conditional visibility: changing a controlling
 *  answer shows or hides dependent fields client-side, no reload. */
function ConditionalFields({
  fields,
  values,
  errors,
}: {
  fields: FieldDef[];
  values: Record<string, string>;
  errors: Record<string, string>;
}) {
  const controllingKeys = new Set(fields.filter((f) => f.conditional).map((f) => f.conditional!.fieldKey));
  const [controls, setControls] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of controllingKeys) initial[key] = values[key] ?? "";
    return initial;
  });

  const currentValue = (key: string) => (controllingKeys.has(key) ? (controls[key] ?? "") : (values[key] ?? ""));

  return (
    <div className="space-y-5">
      {fields.map((field) => {
        if (field.conditional && currentValue(field.conditional.fieldKey) !== field.conditional.value) return null;
        return (
          <PublicFieldInput
            key={field.fieldKey}
            field={field}
            defaultValue={values[field.fieldKey] ?? ""}
            error={errors[field.fieldKey]}
            controlled={
              controllingKeys.has(field.fieldKey)
                ? { value: controls[field.fieldKey] ?? "", onChange: (value) => setControls((s) => ({ ...s, [field.fieldKey]: value })) }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

function AuthCard({
  initialMode,
  authErrors,
  authValues,
}: {
  initialMode: "signup" | "login";
  authErrors: Record<string, string>;
  authValues: { name?: string; email?: string };
}) {
  const [mode, setMode] = useState<"signup" | "login">(initialMode);
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <section className="rounded-lg border border-slate-200 p-5">
      <h2 className="text-base font-semibold text-slate-900">
        {mode === "signup" ? "Create an account to submit" : "Sign in to submit"}
      </h2>
      <p className="mt-1 text-sm text-slate-500">Your submissions stay editable until the deadline.</p>

      <Form method="post" className="mt-4 space-y-4">
        <ErrorSummary errors={authErrors} />
        {mode === "signup" ? (
          <div className="space-y-1.5">
            <label htmlFor="auth-name" className="block text-base font-medium text-slate-900">
              Name<span className="ml-0.5 text-slate-500">*</span>
            </label>
            <input id="auth-name" name="name" defaultValue={authValues.name ?? ""} autoComplete="name" className={publicInput} required />
            {authErrors.name ? <p className="text-sm text-rose-600">{authErrors.name}</p> : null}
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor="auth-email" className="block text-base font-medium text-slate-900">
            Email<span className="ml-0.5 text-slate-500">*</span>
          </label>
          <input id="auth-email" name="email" type="email" defaultValue={authValues.email ?? ""} autoComplete="email" className={publicInput} required />
          {authErrors.email ? <p className="text-sm text-rose-600">{authErrors.email}</p> : null}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="auth-password" className="block text-base font-medium text-slate-900">
            Password<span className="ml-0.5 text-slate-500">*</span>
          </label>
          <input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={publicInput}
            required
            minLength={mode === "signup" ? 8 : undefined}
          />
          {authErrors.password ? <p className="text-sm text-rose-600">{authErrors.password}</p> : null}
        </div>
        <button type="submit" name="intent" value={mode === "signup" ? "auth-signup" : "auth-login"} className={`${publicPrimary} w-full`} disabled={busy}>
          {mode === "signup" ? "Create account and start" : "Sign in"}
        </button>
      </Form>

      <p className="mt-4 text-sm text-slate-500">
        {mode === "signup" ? "Already have an account?" : "No account yet?"}{" "}
        <button type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="font-medium text-accent hover:underline">
          {mode === "signup" ? "Sign in" : "Create one"}
        </button>
      </p>
    </section>
  );
}

function StepHeader({ current }: { current: number }) {
  const names = ["Session details", "Speakers", "Review and submit"];
  return (
    <p className="text-sm font-medium tracking-wide text-slate-500">
      Step {current} of 3: {names[current - 1]}
    </p>
  );
}

/** Every branch of this page (closed, not open, limit reached, thank you, and the
 *  live form) renders through here, so the public header is identical on all of
 *  them and there is always a way back to the event. */
function PublicShell({
  event,
  role,
  children,
}: {
  event: { name: string; slug: string | null };
  role: string | null;
  children: ReactNode;
}) {
  return (
    <>
      <PublicHeader eventName={event.name} eventSlug={event.slug} role={role} />
      <main className="mx-auto w-full max-w-[720px] px-6 py-12">{children}</main>
    </>
  );
}

export default function Submit({ loaderData, actionData }: Route.ComponentProps) {
  const {
    event,
    form,
    state,
    fields,
    user,
    contact,
    contactValues,
    mySubmissions,
    draft,
    limitReached,
    current,
    participants,
    sid,
    step,
    done,
  } = loaderData;

  const errors = actionData?.errors ?? {};
  const notice = actionData?.notice;
  const formError = actionData?.formError;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const closesIn = daysUntil(form.closesAt);
  const deadline = form.closesAt
    ? `Closes ${formatDate(form.closesAt, event.timezone)}${closesIn != null && closesIn > 0 ? `, ${closesIn} ${closesIn === 1 ? "day" : "days"} left` : ""}`
    : "Open for submissions";

  const sessionFields = fields.filter((f) => f.section === "session");
  const speakerFields = fields.filter((f) => f.section === "speaker");
  const hasFileField = sessionFields.some((f) => f.type === "file");

  const branding = (
    <header>
      <p className="text-[13px] font-medium tracking-wide text-slate-500">{event.name}</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{form.name}</h1>
      <p className="mt-2 text-base text-slate-900">{deadline}</p>
      <p className="mt-1 text-sm text-slate-500">
        {formatDateRange(event.startsAt, event.endsAt, event.timezone)}
        {event.location ? `, ${event.location}` : ""}
      </p>
    </header>
  );

  // ---- closed / not open ----
  if (state !== "open" && !done) {
    return (
      <PublicShell event={event} role={user?.role ?? null}>
        {branding}
        <div className="mt-8 rounded-lg border border-slate-200 p-5">
          <p className="text-base text-slate-900">
            {state === "closed"
              ? `Submissions closed${form.closesAt ? ` ${formatDate(form.closesAt, event.timezone)}` : ""}. New submissions are no longer accepted.`
              : `Submissions open ${form.opensAt ? formatDate(form.opensAt, event.timezone) : "soon"}.`}
          </p>
          {user && mySubmissions.length > 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              You can still view your {mySubmissions.length === 1 ? "submission" : "submissions"} in{" "}
              <Link to="/portal" className="font-medium text-accent hover:underline">
                your portal
              </Link>
              .
            </p>
          ) : null}
        </div>
        <nav className="mt-10 border-t border-slate-200 pt-6">
          <Link to="/" className="text-base text-slate-500 hover:text-slate-900">
            Back to the event
          </Link>
        </nav>
      </PublicShell>
    );
  }

  // ---- thank-you screen ----
  if (done && current) {
    return (
      <PublicShell event={event} role={user?.role ?? null}>
        {branding}
        <div className="mt-8 rounded-lg border border-slate-200 p-5">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Thanks, your proposal is in.</h2>
          <p className="mt-2 text-base text-slate-900">
            "{current.title}" was submitted as <span className="font-mono text-[15px]">{current.friendlyId}</span>.
          </p>
          {form.thankYouHtml ? (
            <div className="mt-3 space-y-2 text-base leading-relaxed text-slate-900" dangerouslySetInnerHTML={{ __html: form.thankYouHtml }} />
          ) : null}
          <p className="mt-3 text-sm text-slate-500">
            A confirmation email was sent to {contact?.email ?? "your address"}. You can edit this submission from your portal until the
            form closes.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to={`/portal/submissions/${current.id}`} className={publicPrimary}>
              View your submission
            </Link>
            <Link to="/portal" className={publicSecondary}>
              Go to your portal
            </Link>
          </div>
        </div>
      </PublicShell>
    );
  }

  // ---- logged out: branding, auth, live preview ----
  if (!user) {
    return (
      <PublicShell event={event} role={null}>
        {branding}
        {form.welcomeHtml ? (
          <div className="mt-6 space-y-3 text-base leading-relaxed text-slate-900" dangerouslySetInnerHTML={{ __html: form.welcomeHtml }} />
        ) : null}

        <div className="mt-8">
          <AuthCard
            initialMode={actionData?.authMode ?? "signup"}
            authErrors={actionData?.authErrors ?? {}}
            authValues={actionData?.authValues ?? {}}
          />
        </div>

        <section className="mt-10">
          <h2 className="text-base font-semibold text-slate-900">What the form asks</h2>
          <p className="mt-1 text-sm text-slate-500">
            A preview of the session questions. Create an account above to start a submission.
          </p>
          <div className="mt-5 rounded-lg border border-slate-200 p-5">
            <ConditionalFields fields={sessionFields} values={{}} errors={{}} />
          </div>
        </section>

        <nav className="mt-10 border-t border-slate-200 pt-6">
          <Link to="/" className="text-base text-slate-500 hover:text-slate-900">
            Back to the event
          </Link>
        </nav>
      </PublicShell>
    );
  }

  // ---- logged in, no active submission: start screen ----
  if (!current) {
    return (
      <PublicShell event={event} role={user?.role ?? null}>
        {branding}
        {form.welcomeHtml ? (
          <div className="mt-6 space-y-3 text-base leading-relaxed text-slate-900" dangerouslySetInnerHTML={{ __html: form.welcomeHtml }} />
        ) : null}

        {formError ? (
          <div role="alert" className="mt-6 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-base text-rose-600">
            {formError}
          </div>
        ) : null}

        {draft ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-base text-slate-900">
              You have a saved draft{draft.title ? `: "${draft.title}"` : ""}.
            </p>
            <div className="flex items-center gap-2">
              <Link to={`?sid=${draft.id}&step=1`} className={publicPrimary}>
                Resume draft
              </Link>
              <Form
                method="post"
                onSubmit={(e) => !confirm("Reset saved data? Your draft will be discarded.") && e.preventDefault()}
              >
                <input type="hidden" name="sid" value={draft.id} />
                <button type="submit" name="intent" value="reset-draft" className="text-base font-medium text-slate-500 hover:text-slate-900">
                  Reset saved data
                </button>
              </Form>
            </div>
          </div>
        ) : null}

        {!draft ? (
          limitReached ? (
            <p className="mt-8 text-base text-slate-900">
              You have reached the limit of {form.submissionLimit} {form.submissionLimit === 1 ? "submission" : "submissions"} for this
              form.
            </p>
          ) : (
            <Form method="post" className="mt-8">
              <button type="submit" name="intent" value="start" className={publicPrimary} disabled={busy}>
                Start a submission
              </button>
            </Form>
          )
        ) : null}

        {mySubmissions.filter((s) => !s.isDraft).length > 0 ? (
          <section className="mt-10">
            <h2 className="text-base font-semibold text-slate-900">Your submissions</h2>
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {mySubmissions
                .filter((s) => !s.isDraft)
                .map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <p className="min-w-0 truncate text-base text-slate-900">{s.title}</p>
                    <Link to={`/portal/submissions/${s.id}`} className="text-base font-medium text-accent hover:underline">
                      View
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

        <nav className="mt-10 border-t border-slate-200 pt-6">
          <Link to="/portal" className="text-base text-slate-500 hover:text-slate-900">
            Your portal
          </Link>
        </nav>
      </PublicShell>
    );
  }

  // ---- multi-step form ----
  const stepUrl = (n: number) => `?sid=${current.id}&step=${n}`;
  const editingSubmitted = !current.isDraft;

  return (
    <PublicShell event={event} role={user?.role ?? null}>
      {branding}

      {current.isDraft ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-base text-slate-900">You are editing a draft. Nothing is submitted yet.</p>
          <Form method="post" onSubmit={(e) => !confirm("Reset saved data? Your draft will be discarded.") && e.preventDefault()}>
            <input type="hidden" name="sid" value={current.id} />
            <button type="submit" name="intent" value="reset-draft" className="text-base font-medium text-slate-500 hover:text-slate-900">
              Reset saved data
            </button>
          </Form>
        </div>
      ) : (
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-base text-slate-900">
            Editing "{current.title}" ({current.friendlyId}). Changes save when you finish the review step.
          </p>
        </div>
      )}

      <div className="mt-8">
        <StepHeader current={step} />
      </div>

      {notice ? <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-base text-slate-900">{notice}</div> : null}
      {formError ? (
        <div role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-base text-rose-600">
          {formError}
        </div>
      ) : null}

      {step === 1 ? (
        <Form method="post" encType={hasFileField ? "multipart/form-data" : undefined} noValidate className="mt-5 space-y-5">
          <ErrorSummary errors={errors} />
          <input type="hidden" name="sid" value={current.id} />
          <ConditionalFields fields={sessionFields} values={current.answers} errors={errors} />
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-5">
            <button type="submit" name="intent" value="save-session" className={publicPrimary} disabled={busy}>
              Continue
            </button>
            {form.allowDrafts && current.isDraft ? (
              <button type="submit" name="intent" value="save-draft" className={publicSecondary} disabled={busy}>
                Save draft
              </button>
            ) : null}
          </div>
        </Form>
      ) : null}

      {step === 2 ? (
        <div className="mt-5 space-y-6">
          <section className="rounded-lg border border-slate-200 p-5">
            <h2 className="text-base font-semibold text-slate-900">You</h2>
            <p className="mt-1 text-sm text-slate-500">
              {contact ? `${contact.firstName} ${contact.lastName}`.trim() : user.name}, {contact?.email ?? user.email}
            </p>
            <Form method="post" noValidate className="mt-4 space-y-5">
              <ErrorSummary errors={errors} />
              <input type="hidden" name="sid" value={current.id} />
              <ConditionalFields
                fields={speakerFields}
                values={{ ...contactValues, ...current.answers }}
                errors={errors}
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-5">
                <Link to={stepUrl(1)} className={publicSecondary}>
                  Back
                </Link>
                <button type="submit" name="intent" value="save-speaker" className={publicPrimary} disabled={busy}>
                  Continue
                </button>
              </div>
            </Form>
          </section>

          <section className="rounded-lg border border-slate-200 p-5">
            <h2 className="text-base font-semibold text-slate-900">Co-speakers</h2>
            <p className="mt-1 text-sm text-slate-500">
              Up to {form.maxSpeakers} speakers per submission, including you.
            </p>

            {participants.length > 1 ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {participants.map((p, index) =>
                  index === 0 ? null : (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div>
                        <p className="text-base text-slate-900">{p.name}</p>
                        <p className="text-sm text-slate-500">
                          {ROLE_LABEL[p.role] ?? p.role}
                          {p.company ? `, ${p.company}` : ""}
                        </p>
                      </div>
                      <Form method="post">
                        <input type="hidden" name="sid" value={current.id} />
                        <input type="hidden" name="participantId" value={p.id} />
                        <button
                          type="submit"
                          name="intent"
                          value="remove-cospeaker"
                          className="text-base font-medium text-slate-500 hover:text-slate-900"
                        >
                          Remove
                        </button>
                      </Form>
                    </li>
                  )
                )}
              </ul>
            ) : (
              <p className="mt-3 text-base text-slate-500">No co-speakers added.</p>
            )}

            {participants.length < form.maxSpeakers ? (
              <Form method="post" className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                <input type="hidden" name="sid" value={current.id} />
                {errors.coName ? <p className="text-sm text-rose-600">{errors.coName}</p> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <input name="coName" placeholder="Name" aria-label="Co-speaker name" className={publicInput} />
                  <input name="coEmail" type="email" placeholder="Email" aria-label="Co-speaker email" className={publicInput} />
                  <input name="coTitle" placeholder="Job title (optional)" aria-label="Co-speaker job title" className={publicInput} />
                  <input name="coCompany" placeholder="Company (optional)" aria-label="Co-speaker company" className={publicInput} />
                </div>
                <textarea name="coBio" rows={2} placeholder="Short bio (optional)" aria-label="Co-speaker bio" className={publicTextarea} />
                <div className="flex flex-wrap items-center gap-3">
                  <select name="coRole" aria-label="Co-speaker role" className={`${publicInput} w-auto min-w-40`}>
                    {PARTICIPANT_ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <button type="submit" name="intent" value="add-cospeaker" className={publicSecondary}>
                    Add co-speaker
                  </button>
                </div>
              </Form>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Speaker limit reached for this submission.</p>
            )}
          </section>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-5 space-y-6">
          <section className="rounded-lg border border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Session details</h2>
              <Link to={stepUrl(1)} className="text-base font-medium text-accent hover:underline">
                Change
              </Link>
            </div>
            <dl className="mt-3 space-y-3">
              {visibleFieldsForReview(sessionFields, current.answers).map((field) => (
                <div key={field.fieldKey}>
                  <dt className="text-sm font-medium text-slate-500">{field.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-base text-slate-900">
                    {(current.answers[field.fieldKey] ?? "").trim() || <span className="text-slate-400">Not answered</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-lg border border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Speakers</h2>
              <Link to={stepUrl(2)} className="text-base font-medium text-accent hover:underline">
                Change
              </Link>
            </div>
            <ul className="mt-3 space-y-2">
              {participants.map((p) => (
                <li key={p.id} className="text-base text-slate-900">
                  {p.name} <span className="text-slate-500">({ROLE_LABEL[p.role] ?? p.role}{p.company ? `, ${p.company}` : ""})</span>
                </li>
              ))}
            </ul>
          </section>

          <Form method="post" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="sid" value={current.id} />
            <Link to={stepUrl(2)} className={publicSecondary}>
              Back
            </Link>
            <button type="submit" name="intent" value="submit" className={publicPrimary} disabled={busy}>
              {editingSubmitted ? "Save changes" : "Submit proposal"}
            </button>
          </Form>
          {!editingSubmitted ? (
            <p className="text-sm text-slate-500">
              You can edit your submission from your portal until the form closes
              {form.closesAt ? ` on ${formatDate(form.closesAt, event.timezone)}` : ""}.
            </p>
          ) : null}
        </div>
      ) : null}
    </PublicShell>
  );
}

function visibleFieldsForReview(fields: FieldDef[], answers: Record<string, string>): FieldDef[] {
  return fields.filter((field) => {
    if (!field.conditional) return true;
    return (answers[field.conditional.fieldKey] ?? "") === field.conditional.value;
  });
}
