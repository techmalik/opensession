import { sqliteTable, text, integer, blob, index, uniqueIndex } from "drizzle-orm/sqlite-core";

// ---------- Auth ----------
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    // admin and organizer manage events; evaluator scores; speaker uses the portal
    role: text("role", { enum: ["admin", "organizer", "evaluator", "speaker"] }).notNull().default("speaker"),
    contactId: integer("contact_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)]
);

// ---------- Events ----------
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  tagline: text("tagline"),
  description: text("description"),
  location: text("location"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  startsAt: integer("starts_at", { mode: "timestamp" }),
  endsAt: integer("ends_at", { mode: "timestamp" }),
  status: text("status", { enum: ["draft", "active", "archived"] }).notNull().default("active"),
  // Set by the agenda publish action. Null = the public agenda is not live yet.
  agendaPublishedAt: integer("agenda_published_at", { mode: "timestamp" }),
  createdBy: integer("created_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------- People ----------
export const contacts = sqliteTable(
  "contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // null eventId = org-level contact (Speaker CRM); event contacts link via eventContacts
    email: text("email").notNull(),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    title: text("title"),
    company: text("company"),
    bio: text("bio"),
    headshotBlobKey: text("headshot_blob_key"),
    phone: text("phone"),
    twitter: text("twitter"),
    linkedin: text("linkedin"),
    website: text("website"),
    dietary: text("dietary"),
    tshirt: text("tshirt"),
    // Free-text arrival/logistics notes kept on the speaker record. No booking UI.
    travel: text("travel"),
    notes: text("notes"),
    tagsJson: text("tags_json").notNull().default("[]"), // CRM tags, string[]
    rating: integer("rating"), // CRM 1..5
    customJson: text("custom_json").notNull().default("{}"),
    // The user who entered or imported this record. Half of the CRM visibility rule:
    // an organizer sees the people their own events have touched, plus their own
    // entries. Null on rows that predate the column.
    createdBy: integer("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("contacts_email_uq").on(t.email)]
);

export const eventContacts = sqliteTable(
  "event_contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id").notNull(),
    contactId: integer("contact_id").notNull(),
    kind: text("kind", { enum: ["speaker", "submitter", "attendee", "staff"] }).notNull().default("speaker"),
    // Roster workflow status, independent of a submission's decision status.
    status: text("status", { enum: ["invited", "confirmed", "declined"] }).notNull().default("invited"),
    digestOptIn: integer("digest_opt_in", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    uniqueIndex("event_contacts_uq").on(t.eventId, t.contactId),
    index("event_contacts_event_idx").on(t.eventId),
  ]
);

// ---------- Speaker CRM (organization level, above any single event) ----------

// Timestamped internal notes on a contact. Separate from contacts.notes (a single
// free-text field on the event-level speaker record) because the CRM needs an
// author and a date per entry.
export const crmNotes = sqliteTable(
  "crm_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contactId: integer("contact_id").notNull(),
    body: text("body").notNull(),
    authorUserId: integer("author_user_id"),
    authorName: text("author_name").notNull().default("Unknown"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("crm_notes_contact_idx").on(t.contactId)]
);

// Organizer-defined columns on a contact. Values live in contacts.custom_json,
// keyed by fieldKey, so adding a field never migrates the contacts table.
export const crmFields = sqliteTable(
  "crm_fields",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    type: text("type", { enum: ["text", "select"] }).notNull().default("text"),
    optionsJson: text("options_json").notNull().default("[]"),
    sort: integer("sort").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("crm_fields_key_uq").on(t.fieldKey)]
);

// A saved directory view. "dynamic" re-runs its filters on every open; "curated"
// holds a fixed member list in crm_segment_members.
export const crmSegments = sqliteTable("crm_segments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["dynamic", "curated"] }).notNull().default("dynamic"),
  filtersJson: text("filters_json").notNull().default("{}"),
  createdBy: integer("created_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const crmSegmentMembers = sqliteTable(
  "crm_segment_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    segmentId: integer("segment_id").notNull(),
    contactId: integer("contact_id").notNull(),
  },
  (t) => [uniqueIndex("crm_segment_members_uq").on(t.segmentId, t.contactId)]
);

// Sourcing pipeline. One card per contact per pipeline; stage moves and notes are
// recorded in crm_prospect_events so the card carries its own history.
export const crmProspects = sqliteTable(
  "crm_prospects",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    contactId: integer("contact_id").notNull(),
    // Target event, optional: a prospect can be sourced before an event exists.
    eventId: integer("event_id"),
    stage: text("stage", {
      enum: ["researching", "identified", "contacted", "interested", "confirmed", "declined"],
    })
      .notNull()
      .default("identified"),
    score: integer("score"),
    rationale: text("rationale"),
    sort: integer("sort").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("crm_prospects_contact_uq").on(t.contactId), index("crm_prospects_stage_idx").on(t.stage)]
);

export const crmProspectEvents = sqliteTable(
  "crm_prospect_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    prospectId: integer("prospect_id").notNull(),
    kind: text("kind", { enum: ["stage", "note", "enrolled"] }).notNull(),
    fromStage: text("from_stage"),
    toStage: text("to_stage"),
    body: text("body"),
    authorUserId: integer("author_user_id"),
    authorName: text("author_name").notNull().default("Unknown"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("crm_prospect_events_idx").on(t.prospectId)]
);

// ---------- Taxonomy ----------
export const tracks = sqliteTable("tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#45cc93"),
  sort: integer("sort").notNull().default(0),
});

export const formats = sqliteTable("formats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  durationMin: integer("duration_min"),
  sort: integer("sort").notNull().default(0),
});

export const levels = sqliteTable("levels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#94a3b8"),
});

export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity"),
  sort: integer("sort").notNull().default(0),
});

// System keys: pending, accept_queue, accepted, decline_queue, declined. Custom allowed.
export const statuses = sqliteTable("statuses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  color: text("color").notNull().default("#94a3b8"),
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  sort: integer("sort").notNull().default(0),
});

// ---------- Forms (CFP builder) ----------
export const forms = sqliteTable("forms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  type: text("type", { enum: ["abstract", "session"] }).notNull().default("abstract"),
  welcomeHtml: text("welcome_html"),
  thankYouHtml: text("thank_you_html"),
  opensAt: integer("opens_at", { mode: "timestamp" }),
  closesAt: integer("closes_at", { mode: "timestamp" }),
  submissionLimit: integer("submission_limit"), // max submissions per submitter
  maxSpeakers: integer("max_speakers").notNull().default(4),
  allowDrafts: integer("allow_drafts", { mode: "boolean" }).notNull().default(true),
  allowEditAfterSubmit: integer("allow_edit_after_submit", { mode: "boolean" }).notNull().default(true),
  confirmationSubject: text("confirmation_subject"),
  confirmationBody: text("confirmation_body"),
  reminderDaysJson: text("reminder_days_json").notNull().default("[5,1]"),
  status: text("status", { enum: ["draft", "published", "closed"] }).notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const formFields = sqliteTable(
  "form_fields",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    formId: integer("form_id").notNull(),
    section: text("section", { enum: ["session", "speaker"] }).notNull().default("session"),
    fieldKey: text("field_key").notNull(),
    label: text("label").notNull(),
    helpText: text("help_text"),
    type: text("type", {
      enum: ["text", "textarea", "select", "multiselect", "checkbox", "radio", "number", "date", "email", "url", "file"],
    }).notNull(),
    optionsJson: text("options_json").notNull().default("[]"),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false), // title, abstract, track, format
    sort: integer("sort").notNull().default(0),
    // {"fieldKey": "format", "operator": "equals", "value": "Workshop (120 min)"} or null
    conditionalJson: text("conditional_json"),
  },
  (t) => [index("form_fields_form_idx").on(t.formId)]
);

// ---------- Sessions / submissions ----------
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id").notNull(),
    friendlyId: text("friendly_id").notNull(), // SESS-1042
    title: text("title").notNull(),
    abstract: text("abstract"),
    isAbstract: integer("is_abstract", { mode: "boolean" }).notNull().default(true), // true = submission
    isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
    // Content gate for every public surface. "held" keeps a session off the public
    // agenda, the five embed widgets, and the iCal feed without changing its status.
    publicState: text("public_state", { enum: ["published", "held"] }).notNull().default("published"),
    statusId: integer("status_id"),
    formId: integer("form_id"),
    submittedBy: integer("submitted_by"), // contactId
    trackId: integer("track_id"),
    formatId: integer("format_id"),
    levelId: integer("level_id"),
    roomId: integer("room_id"),
    startsAt: integer("starts_at", { mode: "timestamp" }),
    endsAt: integer("ends_at", { mode: "timestamp" }),
    videoUrl: text("video_url"),
    answersJson: text("answers_json").notNull().default("{}"), // custom field answers keyed by fieldKey
    decisionEmailSentAt: integer("decision_email_sent_at", { mode: "timestamp" }),
    // Optional, organizer-written, decline emails only. Nullable: most declines carry none.
    declineFeedback: text("decline_feedback"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("sessions_event_idx").on(t.eventId),
    index("sessions_status_idx").on(t.statusId),
    uniqueIndex("sessions_friendly_uq").on(t.friendlyId),
  ]
);

export const sessionParticipants = sqliteTable(
  "session_participants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id").notNull(),
    contactId: integer("contact_id").notNull(),
    role: text("role", { enum: ["speaker", "co_speaker", "panelist", "submitter", "moderator", "chairperson"] })
      .notNull()
      .default("speaker"),
    inviteStatus: text("invite_status", { enum: ["invited", "confirmed", "declined"] }).notNull().default("confirmed"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    index("sp_session_idx").on(t.sessionId),
    index("sp_contact_idx").on(t.contactId),
  ]
);

// CNT-11: one row per version of a session's editable content. The row holds the
// values as they were AFTER that edit, so restoring a row is a plain write-back.
export const sessionRevisions = sqliteTable(
  "session_revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id").notNull(),
    title: text("title").notNull(),
    abstract: text("abstract"),
    // Who made the change, kept as a name too so history survives a deleted user.
    editorUserId: integer("editor_user_id"),
    editorName: text("editor_name").notNull().default("Unknown"),
    // "Submitted", "Edited", or "Restored version 3"
    note: text("note").notNull().default("Edited"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("session_revisions_session_idx").on(t.sessionId)]
);

export const sessionTags = sqliteTable(
  "session_tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id").notNull(),
    tagId: integer("tag_id").notNull(),
  },
  (t) => [uniqueIndex("session_tags_uq").on(t.sessionId, t.tagId)]
);

// ---------- Evaluations ----------
export const evalPlans = sqliteTable("eval_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  round: integer("round").notNull().default(1),
  blind: integer("blind", { mode: "boolean" }).notNull().default(true), // evaluators cannot see others' scores
  anonymized: integer("anonymized", { mode: "boolean" }).notNull().default(false), // hide speaker identity
  scaleType: text("scale_type", { enum: ["stars5", "rubric"] }).notNull().default("stars5"),
  maxEvalsPerSubmission: integer("max_evals_per_submission"),
  dueAt: integer("due_at", { mode: "timestamp" }),
  status: text("status", { enum: ["draft", "active", "closed"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const evalCriteria = sqliteTable("eval_criteria", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id").notNull(),
  label: text("label").notNull(),
  // numeric = 1..5 rating, select = dropdown (optionsJson), text = free text.
  // Only numeric criteria count toward the weighted aggregate.
  kind: text("kind", { enum: ["numeric", "select", "text"] }).notNull().default("numeric"),
  optionsJson: text("options_json").notNull().default("[]"),
  weight: integer("weight").notNull().default(1),
  sort: integer("sort").notNull().default(0),
});

// Reviewer pool per plan: membership is scoped to the round, not global.
export const evalPlanReviewers = sqliteTable(
  "eval_plan_reviewers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    planId: integer("plan_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("eval_plan_reviewers_uq").on(t.planId, t.userId)]
);

export const evalAssignments = sqliteTable(
  "eval_assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    planId: integer("plan_id").notNull(),
    evaluatorUserId: integer("evaluator_user_id").notNull(),
    sessionId: integer("session_id").notNull(),
    // "recused": the evaluator declared a conflict of interest. The assignment stays
    // on the record so the organizer can see who stepped back, but it leaves the
    // reviewer's queue and never reaches an aggregate.
    status: text("status", { enum: ["pending", "done", "recused"] }).notNull().default("pending"),
    recusalReason: text("recusal_reason"),
    recusedAt: integer("recused_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("eval_assign_uq").on(t.planId, t.evaluatorUserId, t.sessionId),
    index("eval_assign_user_idx").on(t.evaluatorUserId),
  ]
);

export const evalScores = sqliteTable(
  "eval_scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assignmentId: integer("assignment_id").notNull(),
    criterionId: integer("criterion_id"), // null for stars5 overall score
    score: integer("score").notNull(), // 0 for select/text criteria; valueText holds the answer
    valueText: text("value_text"),
    comment: text("comment"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("eval_scores_assignment_idx").on(t.assignmentId)]
);

// AI evaluator personas produce reviews too; kept separate from human scores.
// An organizer may override a persona's score: the original stays in `score` so the
// panel can show what the model said next to what the human decided.
export const aiReviews = sqliteTable("ai_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(),
  persona: text("persona").notNull(),
  score: integer("score").notNull(),
  reviewText: text("review_text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  overrideScore: integer("override_score"),
  overrideReason: text("override_reason"),
  overrideBy: text("override_by"),
  overrideAt: integer("override_at", { mode: "timestamp" }),
});

// ---------- Speaker portal: tasks ----------
export const portalTasks = sqliteTable("portal_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  dueAt: integer("due_at", { mode: "timestamp" }),
  // "selected" resolves through taskAssignees; the other two resolve from the roster.
  appliesTo: text("applies_to", { enum: ["all_speakers", "accepted_speakers", "selected"] })
    .notNull()
    .default("accepted_speakers"),
  sort: integer("sort").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const taskAssignees = sqliteTable(
  "task_assignees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    contactId: integer("contact_id").notNull(),
  },
  (t) => [uniqueIndex("task_assignees_uq").on(t.taskId, t.contactId)]
);

export const taskCompletions = sqliteTable(
  "task_completions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull(),
    contactId: integer("contact_id").notNull(),
    status: text("status", { enum: ["todo", "done"] }).notNull().default("todo"),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (t) => [uniqueIndex("task_completion_uq").on(t.taskId, t.contactId)]
);

// ---------- Content management: files, versions, approvals ----------
export const fileRequests = sqliteTable("file_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions"),
  dueAt: integer("due_at", { mode: "timestamp" }),
  sampleBlobKey: text("sample_blob_key"),
  sampleFilename: text("sample_filename"),
  appliesTo: text("applies_to", { enum: ["all_speakers", "accepted_speakers", "selected"] })
    .notNull()
    .default("accepted_speakers"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const fileRequestAssignees = sqliteTable(
  "file_request_assignees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id").notNull(),
    contactId: integer("contact_id").notNull(),
  },
  (t) => [uniqueIndex("file_request_assignees_uq").on(t.requestId, t.contactId)]
);

export const fileUploads = sqliteTable(
  "file_uploads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id"), // null = ad hoc attachment
    eventId: integer("event_id").notNull(),
    contactId: integer("contact_id"),
    sessionId: integer("session_id"),
    version: integer("version").notNull().default(1),
    blobKey: text("blob_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    approval: text("approval", { enum: ["pending", "approved", "denied"] }).notNull().default("pending"),
    reviewedByUserId: integer("reviewed_by_user_id"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    uploadedBy: integer("uploaded_by"), // userId
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("file_uploads_request_idx").on(t.requestId),
    index("file_uploads_session_idx").on(t.sessionId),
  ]
);

export const fileComments = sqliteTable("file_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uploadId: integer("upload_id").notNull(),
  authorUserId: integer("author_user_id").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// D1 blob store (R2 optional upgrade; abstraction in app/lib/storage.ts)
export const blobs = sqliteTable("blobs", {
  key: text("key").primaryKey(),
  data: blob("data", { mode: "buffer" }).notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------- Communications ----------
export const emailTemplates = sqliteTable("email_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  key: text("key").notNull(), // confirmation, acceptance, decline, reminder, custom
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const emailSends = sqliteTable(
  "email_sends",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id"),
    templateKey: text("template_key"),
    toEmail: text("to_email").notNull(),
    toContactId: integer("to_contact_id"),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    icsAttached: integer("ics_attached", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["queued", "sent", "failed", "test"] }).notNull().default("queued"),
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    sentAt: integer("sent_at", { mode: "timestamp" }),
  },
  (t) => [index("email_sends_contact_idx").on(t.toContactId)]
);

// ---------- Jobs (outbox pattern; processed by cron since Queues needs a paid plan) ----------
export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", {
      enum: ["email", "airtable_push", "airtable_pull", "reminder", "digest", "accelevents_push", "task_reminder"],
    }).notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    runAfter: integer("run_after", { mode: "timestamp" }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    status: text("status", { enum: ["pending", "running", "done", "failed"] }).notNull().default("pending"),
    lastError: text("last_error"),
    // When the current claim expires. A job left "running" past this (an isolate that
    // died mid-handler) is reclaimed by the next tick instead of stalling forever.
    leaseUntil: integer("lease_until", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.runAfter)]
);

// One row per (speaker, deliverable) that has been reminded about, holding the last
// time we mailed them about it. The cron consults this instead of any in-memory
// state: it runs in a fresh isolate every five minutes, so "at most once a day"
// only means anything if it is written down.
export const taskReminders = sqliteTable(
  "task_reminders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id").notNull(),
    contactId: integer("contact_id").notNull(),
    // "task" = portal_tasks row, "file_request" = file_requests row
    kind: text("kind", { enum: ["task", "file_request"] }).notNull(),
    refId: integer("ref_id").notNull(),
    lastRemindedAt: integer("last_reminded_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("task_reminders_uq").on(t.contactId, t.kind, t.refId)]
);

// ---------- Airtable two-way sync ----------
export const airtableLinks = sqliteTable(
  "airtable_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tableName: text("table_name").notNull(), // local table
    recordId: integer("record_id").notNull(), // local row id
    airtableId: text("airtable_id").notNull(),
    lastPushedHash: text("last_pushed_hash"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  },
  (t) => [uniqueIndex("airtable_links_uq").on(t.tableName, t.recordId)]
);

// ---------- Public API ----------
export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  // The organizer who created the token. Null on tokens minted before the column
  // existed; the MCP server reads it to scope a token to the events its creator can
  // open, and falls back to the API's installation-wide reach when it is null.
  createdBy: integer("created_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
});

// ---------- Settings (Accelevents integration config, embed cache flags, etc.) ----------
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---------- Saved embeds ----------
// A named, reusable widget configuration. The snippet points at
// /embed/v1/:slug/saved/:id, so switching `enabled` off empties every page that
// already pasted the snippet without anyone editing their HTML.
export const savedEmbeds = sqliteTable("saved_embeds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  widgetType: text("widget_type").notNull(),
  // { track, format, height, accent, header } as stored by the Embeds configurator
  configJson: text("config_json").notNull().default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ---------- Per-user UI flags ----------
// One row per (user, flag). Dismissing the getting-started card writes a row here
// rather than a cookie, so the dismissal follows the account across browsers.
export const userFlags = sqliteTable(
  "user_flags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    flag: text("flag").notNull(),
    setAt: integer("set_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("user_flags_uq").on(t.userId, t.flag)]
);
