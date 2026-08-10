# OpenSession: Sessionboard clone for the Kill My SaaS competition

## Mission and judging reality

Open-source replacement for Sessionboard, built for the AI Engineer conference team.
Two judges:
1. An automated LLM browser agent (Playwright) that executes the scenarios in
   `spec/specs/*.yaml` and scores 96 rubric items. `spec/docs/*.md` describes the
   intended behavior of every area. `spec/fixtures-sample-data.json` is the exact
   data the agent types (event DevFlow Conf 2027, personas Jordan Alvarez, Priya
   Raman, Marcus Okafor, Sam Whitfield).
2. Non-technical conference organizers using the hosted app end to end.

Deadline-critical project. Working and obvious beats clever and fragile.

## Non-negotiable product rules

- The eval agent signs in with fixture credentials (already seeded, see seed.sql) or
  signs up openly. Signup must work without email verification. Password login always.
- The agent creates the event "DevFlow Conf 2027" itself. Event create must be a
  short single form. Multi-event is supported; the seeded demo event is "Meridian
  Dev Summit 2027" so it never collides with fixture data.
- Enforcement is real, server-side: closed forms reject submissions; submission
  limits enforced; agenda double-booking (room or person) detected and surfaced;
  speakers see only their own data; evaluators never see other evaluators' scores
  when the plan is blind; drafts are not visible to reviewers.
- Roundtrips must close: reviewer score -> visible in organizer aggregate; accepted
  abstract -> becomes session -> schedulable on agenda -> appears in public widgets
  and iCal without re-entry. Decision emails are an explicit separate send step
  after status change (accept queue -> send emails), matching Sessionboard.
- Every list view: search, filters, bulk select with bulk actions, CSV export.
- Every email is written to email_sends and visible under Communications with a
  test-send button. Acceptance and schedule emails attach .ics files.
- Conditional form fields (show when another answer matches) must toggle client-side
  without a page reload. The CFP spec tests this explicitly with
  "Workshop prerequisites" shown only for format "Workshop (120 min)".
- Public CFP form, speaker portal, and embeds work at 375px width, logged out where
  applicable, with the event name and deadline visible on the public CFP page.
- Vocabulary everywhere: Submissions, Abstracts, Sessions, Tracks, Formats,
  Evaluation Plans, Portals, Tasks, File Requests, Embeds, Statuses (Pending,
  Accept Queue, Accepted, Decline Queue, Declined).

## Design

Read DESIGN.md before writing any UI. It is enforced. Professional, dense, quiet
B2B. No gradients, no glassmorphism, no emoji, no em dashes, no hype copy.

## Stack

- React Router v7 framework mode (SSR) on Cloudflare Workers. Entry: workers/app.ts.
- D1 via Drizzle ORM. Schema: database/schema.ts. Migrations: drizzle-kit generate,
  applied with wrangler d1 migrations apply. Never edit generated SQL by hand.
- Storage: app/lib/storage.ts abstraction. Default backend stores blobs in D1
  (blobs table, few-MB files are fine). R2 optional behind the same interface.
- Auth: app/lib/auth.ts. PBKDF2-SHA256 via WebCrypto (100k iterations), signed
  session cookie (SESSION_SECRET). Roles: admin, organizer, evaluator, speaker.
- Email: app/lib/email.ts. Provider abstraction: BREVO_API_KEY sends via Brevo API;
  without a key it logs sends with status "test" so the UI evidence still exists.
  Every send inserts into email_sends first, then attempts delivery.
- Jobs: jobs table processed by scheduled() cron handler every 5 minutes (Cloudflare
  Queues needs a paid plan; do not use Queues). Email retries, Airtable sync,
  reminders, digests all go through jobs.
- AI features (AI agenda assist, AI evaluator personas): Workers AI binding if
  available, else ANTHROPIC_API_KEY var, else return a deterministic heuristic
  fallback (greedy scheduler; template reviews) so features never 500 without keys.
- Public API under /api/v1 with x-access-token auth, mirroring Sessionboard's API
  shapes (events list, session search POST /api/v1/event/:id/sessions, session CRUD,
  contacts, statuses, tracks/tags/formats/rooms). Paginate with page/pageSize.
- Embeds under /embed/v1/:eventSlug/{sessions|speakers|agenda|itinerary|gallery}
  as fast server-rendered HTML with a JS snippet one-liner, JSON variant via
  Accept header or .json suffix, and /calendar.ics feed. Edge cache 60 minutes,
  manual "refresh embeds" button busts the cache version in settings.

## Workflow rules

- TypeScript strict. Small route modules. No new dependencies without strong reason.
- After every feature: `npm run typecheck && npm run build` must pass, update
  seed.sql if the schema changed, and click the flow once in `npm run dev`.
- Never break `npm run deploy`. Deploy = wrangler deploy after react-router build.
- When a spec/*.yaml rubric item is satisfied, note its ID in the commit message.
- Commit small and often. Do not refactor working features near the deadline.

## Environment notes (learned in Phase 1, keep current)

- Deploy with `npm run deploy` only. Bare `wrangler deploy` ships the stale
  `build/server/wrangler.json` from the previous build, including old vars.
- compatibility_date must stay at or below what the installed workerd supports
  (currently 2026-08-08) or `npm run dev` cannot boot. Deploys are unaffected.
  Bump it only together with a wrangler upgrade.
- React Router v8: `meta()` receives `{ loaderData }`, not `{ data }`.
- Route files whose component code touches a `.server` module fail the client
  build. Shared constants go in plain lib files (see app/lib/timezones.ts).
- A route that renders a component cannot return a raw Response from its
  loader. CSV exports and similar get their own resource route (pattern:
  app/routes/admin.export.tsx).
- Auth guards: requireUser redirects to /login?next=..., requireOrganizer
  returns 403. After login: organizers land on /admin, evaluators on /review,
  speakers on /portal (landingFor in app/routes/login.tsx).
- Public CFP URLs: /cfp/:eventSlug is the entry page, the live form is
  /submit/:eventSlug/:formSlug, and /cfp/:eventSlug/submit redirects there.
- Speaker-visible status mapping (app/lib/cfp.server.ts speakerStatus):
  queues stay internal, speakers see Under review until Accepted/Declined.
- Setting a submission's status to accepted flips is_abstract to 0 (it becomes
  a session); any other status flips it back. Send-decisions also stamps
  decisionEmailSentAt.
- The session cookie is Secure: Safari will not store it on http://localhost.
  Chromium, Playwright, and the deployed https site are fine.
- Live URL: https://opensession.opensession.workers.dev. Remote D1 is
  migrated and seeded. Local D1 resets with `npm run db:local`.
