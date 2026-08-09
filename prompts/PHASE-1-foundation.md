# Phase 1: Foundation (auth, shell, events)

Suggested run: Opus, high effort/extended thinking. This phase sets patterns everything else copies.

Prompt to paste:

Read CLAUDE.md, DESIGN.md, spec/docs/00-how-sessionboard-works.md, and spec/specs/01-call-for-papers.yaml (scenario CFP-S1 steps 1-2 especially). Then build the foundation:

1. Auth: /login, /signup, /logout using app/lib/auth.ts (already implemented; do not rewrite it). Open signup with name, email, password, and an account-type choice (Organizer or Speaker). No email verification. Seeded users in database/seed.sql must be able to log in (verify sbek-organizer@example.com / SbekTest!2027-org works). Session via the signed cookie helpers. requireUser / requireRole loader helpers in app/lib/session.server.ts.
2. App shell per DESIGN.md: 232px sidebar with event switcher and nav (Dashboard, Program group: Submissions, Forms, Evaluations, Agenda, Speakers; Contacts; Portals; Communications; Embeds; Settings). Inter font via @fontsource-variable/inter. Root layout, error boundary, 404.
3. Events: list (/admin), create (short single form: name, dates, location, description, timezone), edit in Settings. Creating an event auto-creates the 5 system statuses, and empty tracks/formats/rooms management screens under Settings (add/rename/delete/reorder, with sensible inline forms, no modals maze). The eval agent will create "DevFlow Conf 2027" with tracks and formats from spec/fixtures-sample-data.json; make that path take under a minute.
4. Landing page at /: event name, links to Submit a talk (active event's published form if any), Organizer sign in, Speaker portal, API docs placeholder.
5. Dashboard: counts by status, recent submissions, CFP close countdown. Server-rendered from D1.

Update seed if needed, keep npm run typecheck && npm run build green, and end by listing which CFP-S1 rubric expectations are now satisfiable.
