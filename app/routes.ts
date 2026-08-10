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
  route("portal/submissions/:sessionId", "routes/portal.submission.tsx"),
  route("review", "routes/review.tsx"),
  route("review/:assignmentId", "routes/review.assignment.tsx"),

  // Uploaded files, access-checked per requester.
  route("files/:uploadId", "routes/file.download.tsx"),

  // Phase 5 replaces this with real API docs.
  route("api-docs", "routes/public.soon.tsx", { id: "public-api-docs" }),

  // Event list and creation sit outside the event shell: there is no event to
  // switch to yet.
  route("admin", "routes/admin.tsx"),
  route("admin/new", "routes/admin.new.tsx"),
  route("admin/export.csv", "routes/admin.export.tsx"),

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

    // Phase 3 to 5 replace these. They exist now so the nav never dead-ends.
    route("agenda", "routes/event.soon.tsx", { id: "event-agenda" }),
    route("speakers", "routes/event.soon.tsx", { id: "event-speakers" }),
    route("contacts", "routes/event.soon.tsx", { id: "event-contacts" }),
    route("portals", "routes/event.soon.tsx", { id: "event-portals" }),
    route("communications", "routes/event.soon.tsx", { id: "event-communications" }),
    route("embeds", "routes/event.soon.tsx", { id: "event-embeds" }),
  ]),
] satisfies RouteConfig;
