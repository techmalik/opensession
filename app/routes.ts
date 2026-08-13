import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  // Auth
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),
  // Landing-page demo buttons. POST only, and restricted to the three seeded
  // demo accounts by app/lib/roles.ts.
  route("demo/:role", "routes/demo.tsx"),

  // Public event page: the one place a specific event has a page of its own.
  route("e/:eventSlug", "routes/event-public.tsx"),

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

  // Public agenda, the page the agenda publish action points at. It is a thin
  // wrapper over the same data the embed widgets read.
  route("agenda/:eventSlug", "routes/agenda.public.tsx"),

  // Public widgets. Five HTML surfaces, a JSON variant of each at the same path
  // with a .json suffix, a calendar feed, public headshots, and the script embed.
  // Static last segments so they always outrank the .json and .ics siblings.
  route("embed/v1/:eventSlug/sessions", "routes/embed.sessions.tsx"),
  route("embed/v1/:eventSlug/speakers", "routes/embed.speakers.tsx"),
  route("embed/v1/:eventSlug/agenda", "routes/embed.agenda.tsx"),
  route("embed/v1/:eventSlug/itinerary", "routes/embed.itinerary.tsx"),
  route("embed/v1/:eventSlug/gallery", "routes/embed.gallery.tsx"),
  route("embed/v1/:eventSlug/sessions.json", "routes/embed.json.tsx", { id: "embed-json-sessions" }),
  route("embed/v1/:eventSlug/speakers.json", "routes/embed.json.tsx", { id: "embed-json-speakers" }),
  route("embed/v1/:eventSlug/agenda.json", "routes/embed.json.tsx", { id: "embed-json-agenda" }),
  route("embed/v1/:eventSlug/itinerary.json", "routes/embed.json.tsx", { id: "embed-json-itinerary" }),
  route("embed/v1/:eventSlug/gallery.json", "routes/embed.json.tsx", { id: "embed-json-gallery" }),
  route("embed/v1/:eventSlug/calendar.ics", "routes/embed.ics.tsx"),
  route("embed/v1/:eventSlug/itinerary.ics", "routes/embed.itinerary.ics.tsx"),
  route("embed/v1/:eventSlug/headshot/:contactId", "routes/embed.headshot.tsx"),
  route("embed/v1/:eventSlug/saved/:savedId", "routes/embed.saved.tsx"),
  route("embed/v1/:eventSlug/embed.js", "routes/embed.script.tsx"),

  // Short public aliases the eval agent probes before it knows the slug.
  route("sessions", "routes/public-alias.tsx", { id: "public-alias-sessions" }),
  route("speakers", "routes/public-alias.tsx", { id: "public-alias-speakers" }),
  route("agenda", "routes/public-alias.tsx", { id: "public-alias-agenda" }),
  route("schedule", "routes/public-alias.tsx", { id: "public-alias-schedule" }),
  route("gallery", "routes/public-alias.tsx", { id: "public-alias-gallery" }),

  // Uploaded files, access-checked per requester.
  route("files/:uploadId", "routes/file.download.tsx"),
  // Same access check, image bytes only: the thumbnail source for signed-in screens.
  route("files/:uploadId/image", "routes/file.image.tsx"),

  route("docs/api", "routes/docs.api.tsx"),

  // MCP server. Same API tokens, JSON-RPC over one POST. See app/lib/mcp.server.ts.
  route("mcp", "routes/mcp.tsx"),

  // Public API. Token auth via x-access-token, JSON in and out, no session cookie.
  route("api/v1/events", "routes/api.events.tsx"),
  route("api/v1/event/:eventId", "routes/api.event.tsx"),
  route("api/v1/event/:eventId/sessions", "routes/api.sessions.tsx"),
  route("api/v1/event/:eventId/sessions/:sessionId", "routes/api.session.tsx"),
  route("api/v1/event/:eventId/contacts", "routes/api.taxonomy.tsx", { id: "api-contacts" }),
  route("api/v1/event/:eventId/statuses", "routes/api.taxonomy.tsx", { id: "api-statuses" }),
  route("api/v1/event/:eventId/tracks", "routes/api.taxonomy.tsx", { id: "api-tracks" }),
  route("api/v1/event/:eventId/formats", "routes/api.taxonomy.tsx", { id: "api-formats" }),
  route("api/v1/event/:eventId/rooms", "routes/api.taxonomy.tsx", { id: "api-rooms" }),

  // Speaker CRM: the organization-level contact database. Deliberately outside
  // /admin/:eventId, because it belongs to the org and not to one event.
  route("crm", "routes/crm.tsx", [
    index("routes/crm.dashboard.tsx"),
    route("contacts", "routes/crm.contacts.tsx"),
    route("contacts/new", "routes/crm.contact.new.tsx"),
    route("contacts/export.csv", "routes/crm.export.tsx"),
    route("contacts/:contactId", "routes/crm.contact.tsx"),
    route("duplicates", "routes/crm.duplicates.tsx"),
    route("import", "routes/crm.import.tsx"),
    route("segments", "routes/crm.segments.tsx"),
    route("fields", "routes/crm.fields.tsx"),
    route("email", "routes/crm.email.tsx"),
    route("pipeline", "routes/crm.pipeline.tsx"),
    route("pipeline/:prospectId", "routes/crm.prospect.tsx"),
  ]),
  // Names an organizer might guess for the same thing.
  route("contacts", "routes/crm-alias.tsx", { id: "crm-alias-contacts" }),
  route("speaker-crm", "routes/crm-alias.tsx", { id: "crm-alias-speaker-crm" }),
  route("directory", "routes/crm-alias.tsx", { id: "crm-alias-directory" }),

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
    route("settings/integrations", "routes/event.integrations.tsx"),
    route("settings/api", "routes/event.api.tsx"),

    // Cmd+K palette search. JSON only, fetched by app/components/palette.tsx.
    route("palette.json", "routes/event.palette.tsx"),

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

    route("embeds", "routes/event.embeds.tsx"),
  ]),
] satisfies RouteConfig;
