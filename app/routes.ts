import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  // Auth
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),

  // Public destinations the landing page links to. Phases 2, 3, and 5 replace these
  // with the real CFP form, speaker portal, and API docs.
  route("cfp/:eventSlug", "routes/cfp.tsx"),
  route("cfp/:eventSlug/submit", "routes/public.soon.tsx", { id: "public-cfp-submit" }),
  route("portal", "routes/public.soon.tsx", { id: "public-portal" }),
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

    // Phase 2 to 5 replace these. They exist now so the nav never dead-ends.
    route("submissions", "routes/event.soon.tsx", { id: "event-submissions" }),
    route("forms", "routes/event.soon.tsx", { id: "event-forms" }),
    route("evaluations", "routes/event.soon.tsx", { id: "event-evaluations" }),
    route("agenda", "routes/event.soon.tsx", { id: "event-agenda" }),
    route("speakers", "routes/event.soon.tsx", { id: "event-speakers" }),
    route("contacts", "routes/event.soon.tsx", { id: "event-contacts" }),
    route("portals", "routes/event.soon.tsx", { id: "event-portals" }),
    route("communications", "routes/event.soon.tsx", { id: "event-communications" }),
    route("embeds", "routes/event.soon.tsx", { id: "event-embeds" }),
  ]),
] satisfies RouteConfig;
