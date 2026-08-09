# Phase 3: Speaker portal, agenda + AI, content management (40 rubric points)

Suggested run: Opus high effort for the agenda; Sonnet medium is fine for the portal CRUD.

## A. Speaker portal (spec/specs/03-speaker-management.yaml + docs)

/portal for role speaker: My submissions (status badges, edit until close), invited sessions with Confirm/Decline participation, My profile (bio, headshot upload via app/lib/storage.ts, title, company, links, dietary, tshirt), My tasks (portal_tasks filtered by applies_to, check off, due dates, overdue state), My files (file requests relevant to me, upload new version, see approval state and comments), My schedule (my accepted sessions with date/room and a "Add to calendar" .ics download). Mobile-first per DESIGN.md. Scoping is absolute: only own data, tested by the spec with two speaker accounts.

## B. Speakers area (organizer)

Speakers table (from event_contacts kind speaker): search, filters (has accepted session, missing headshot, missing bio, incomplete tasks), bulk email to filtered set (via template with merge tags, queued through jobs), CSV export, CSV import (headers auto-map to contacts fields, preview before commit; spec/fixtures has speakers.csv shape), speaker detail (profile, sessions, tasks, files, email history). Portal task management: task CRUD + completion matrix (speakers x tasks) with counts.

## C. Agenda + AI assist (spec/specs/05-ai-agenda.yaml + docs)

Agenda screen: day tabs from event dates, rooms as columns, 15-min grid, unscheduled accepted sessions in a right sidebar, drag to place (pointer events; also a no-drag fallback: click session -> pick room/time form, the eval agent may not drag reliably), resize by duration from format, track color chips, list view toggle. Conflict engine (server): room double-booked, speaker in two places, session outside event hours; conflicts panel listing each with a Fix link; conflicting placements highlighted, allowed but warned. "AI assist" button: propose full schedule for unscheduled accepted sessions (Workers AI binding, ANTHROPIC_API_KEY fallback, else deterministic greedy: longest formats first, no speaker overlaps, spread tracks across rooms); show proposal as a diff (session -> slot) with Apply all / apply per row and a one-line reason each. Schedule change queues "schedule" email with updated .ics (app/lib/ics.ts: build VEVENT with UID per session, METHOD REQUEST, TZID from event).

## D. Content management (spec/specs/04-content-management.yaml + docs)

File requests CRUD (title, instructions, due date, sample file, applies_to). Uploads land in Content review queue: table with request, speaker, session, version, status; preview/download; Approve / Deny with required comment on deny; comment thread per upload (fileComments) visible to the speaker in portal; new version resets to pending and increments version, all versions listed with dates; ZIP export of latest approved per request (build zip in Worker: fflate, add dependency); per-session files tab on submission detail.

Green build, seed updated (one approved v2 upload, one denied with comment, one pending), list rubric IDs satisfied.
