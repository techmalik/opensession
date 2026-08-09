# Phase 4: Public widgets, email delivery, jobs, Airtable sync (20+ points and two bonuses)

Suggested run: Opus high effort for widgets and sync; Sonnet medium for wiring jobs.

## A. Public widgets (spec/specs/06-public-widgets.yaml + docs). 20 required points, read carefully.

Server-rendered public pages under /embed/v1/:eventSlug/: sessions (searchable list, filter by track/format/tag, session detail expand with speakers), speakers (grid with headshots, name, title, company, link to their sessions), agenda (day/room grid, mobile collapses to per-day list), itinerary (chronological list with times, personal star-to-build-itinerary using localStorage is NOT allowed in artifacts but this is our own app: use a cookie), gallery (headshot wall). All: no login, fast, mobile-perfect at 375px, event branding header, edge cache (Cache-Control public max-age 3600, cache key includes settings.embed_cache_version). JSON variants at same path with .json suffix. iCal feed /embed/v1/:eventSlug/calendar.ics (all scheduled public sessions, valid VCALENDAR, opens in Google Calendar). Embeds admin screen: preview each widget, copy iframe snippet and one-line script embed, "Refresh embeds" button bumps embed_cache_version. Only accepted, scheduled, non-draft sessions appear publicly; the spec checks a declined talk never leaks.

## B. Email delivery + Communications

Fill in jobs.server.ts email handler: deliver queued email_sends via sendEmail path (Brevo), retries/backoff already in runner. Communications screen: template editor (subject, body, merge-tag reference), Test send to me button per template, sends log table (to, subject, status, provider id, error, timestamp) with filters, per-contact history on speaker detail. Reminder handler: forms with reminder_days_json get reminder jobs scheduled relative to closes_at emailing submitters with drafts or unfinished profiles. Digest handler: weekly summary to opted-in speakers listing open tasks and file requests.

## C. Airtable two-way sync (bonus)

app/lib/airtable.server.ts: ensure base schema via Airtable Meta API (tables: Sessions, Contacts, Statuses mirrors with a Local ID field), push handler: changed local rows upsert to Airtable (hash compare via airtable_links), pull handler: list records modified since last sync, write allowed fields back (title, abstract, status by label, track by name, speaker bio/company), conflict rule: latest write wins, log to jobs.lastError never fail hard. Airtable rate limit 5 rps: batch 10 records per request, sleep between. Settings > Integrations: connection status, base link, Sync now button, last sync time, per-table row counts. Works only when AIRTABLE_API_KEY and AIRTABLE_BASE_ID secrets exist; UI shows setup instructions otherwise.

## D. Accelevents integration (brief item 7, best effort by design)

Settings > Integrations > Accelevents: API key + event id fields (stored in settings), field mapping preview table (our session/speaker fields -> their agenda/speaker fields), Dry run button showing the would-be payload diff, hourly push job when enabled, push log. Client in app/lib/accelevents.server.ts against their documented public API; failures logged visibly.

Green build, rubric IDs listed, and verify: submit -> accept -> schedule -> widget -> ics roundtrip manually in dev.
