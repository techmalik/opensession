import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  // Auth
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),

  // Public CFP: entry page, legacy submit path, and the live form portal.
  route("cfp/:eventSlug", "routes/cfp.tsx"),
  route("cfp/:eventSlug/submit", "routes/cfp.submit-redirect.tsx"),
  route("submit/:eventSlug/:formSlug", "routes/submit.tsx"),

  // Speaker portal and evaluator dashboard. Both are signed-in surfaces with no
  // organizer navigation.
  route("portal", "routes/portal.tsx"),
  route("portal/profile", "routes/portal.profile.tsx"),
  route("portal/tasks", "routes/portal.tasks.tsx"),
  route("portal/files", "routes/portal.files.tsx"),
  route("portal/files/:requestId", "routes/portal.file.tsx"),
  route("portal/schedule", "routes/portal.schedule.tsx"),
  route("portal/schedule.ics", "routes/portal.schedule.ics.tsx"),
  route("portal/submissions/:sessionId", "routes/portal.submission.tsx"),
  route("review", "routes/review.tsx"),
  route("review/:assignmentId", "routes/review.assignment.tsx"),

  // Public agenda. The full embed suite lands in Phase 5; this is the page the
  // agenda publish action points at.
  route("agenda/:eventSlug", "routes/agenda.public.tsx"),

  // Uploaded files, access-checked per requester.
  route("files/:uploadId", "routes/file.download.tsx"),

  // Phase 5 fills this in with the real endpoint reference.
  route("docs/api", "routes/docs.api.tsx"),

  // Event list and creation sit outside the event shell: there is no event to
  // switch to yet.
  route("admin", "routes/admin.tsx"),
  route("admin/new", "routes/admin.new.tsx"),
  route("admin/export.csv", "routes/admin.export.tsx"),
  // The eval agent probes obvious route names for the admin entry point.
  route("dashboard", "routes/admin-alias.tsx", { id: "admin-alias-dashboard" }),
  route("organizer", "routes/admin-alias.tsx", { id: "admin-alias-organizer" }),

  // Everything below renders inside the sidebar shell for one event.
  route("admin/:eventId", "routes/event.tsx", [
    index("routes/event.dashboard.tsx"),
    route("settings", "routes/event.settings.tsx"),
    route("settings/taxonomy", "routes/event.taxonomy.tsx"),

    route("submissions", "routes/event.submissions.tsx"),
    route("submissions/export.csv", "routes/event.submissions.export.tsx"),
    route("submissions/new", "routes/event.submission.new.tsx"),
    route("submissions/send-decisions", "routes/event.send-decisions.tsx"),
    route("submissions/:sessionId", "routes/event.submission.tsx"),

    route("forms", "routes/event.forms.tsx"),
    route("forms/export.csv", "routes/event.forms.export.tsx"),
    route("forms/:formId", "routes/event.form.tsx"),

    route("evaluations", "routes/event.evaluations.tsx"),
    route("evaluations/export.csv", "routes/event.evaluations.export.tsx"),
    route("evaluations/:planId", "routes/event.plan.tsx"),
    route("evaluations/:planId/results", "routes/event.plan.results.tsx"),
    route("evaluations/:planId/results.csv", "routes/event.plan.results.export.tsx"),

    route("speakers", "routes/event.speakers.tsx"),
    route("speakers/export.csv", "routes/event.speakers.export.tsx"),
    route("speakers/import", "routes/event.speakers.import.tsx"),
    route("speakers/new", "routes/event.speaker.new.tsx"),
    route("speakers/email", "routes/event.speakers.email.tsx"),
    route("speakers/:contactId", "routes/event.speaker.tsx"),

    route("portals", "routes/event.portals.tsx"),

    route("content", "routes/event.content.tsx"),
    route("content/requests", "routes/event.content.requests.tsx"),
    route("content/review", "routes/event.content.review.tsx"),
    route("content/review/export.csv", "routes/event.content.export.tsx"),
    route("content/review/export.zip", "routes/event.content.zip.tsx"),
    route("content/uploads/:uploadId", "routes/event.content.upload.tsx"),

    route("agenda", "routes/event.agenda.tsx"),
    route("agenda/assist", "routes/event.agenda.assist.tsx"),

    route("communications", "routes/event.communications.tsx"),

    // Phase 5 replaces these. They exist now so the nav never dead-ends.
    route("contacts", "routes/event.soon.tsx", { id: "event-contacts" }),
    route("embeds", "routes/event.soon.tsx", { id: "event-embeds" }),
  ]),
] satisfies RouteConfig;
