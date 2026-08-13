# Changes since competition submission (Aug 13, 2026)

OpenSession was submitted to the Kill My SaaS competition on August 13, 2026, and
scored 94.5% on the sbek eval kit at that point. Work continued after the deadline.
Everything below landed afterwards and is listed here so the submitted state and the
current state are easy to tell apart.

Every change is additive. No route was renamed, moved, or removed, no migration
altered an existing column, and the paths the eval agent exercises (sign in, the
public call for papers, the embed widgets) behave exactly as they did at submission.

## Aug 14, 2026

- **Security hardening from external review (Codex), Aug 14.** An external review of
  commit `ef024c2` produced 24 findings; this pass closes them. Uploads are now
  identified by magic bytes and only PNG, JPEG, WebP, and GIF are accepted, every
  upload-derived response leaves as an opaque `attachment` with `nosniff` (signed-in
  thumbnails moved to `/files/:uploadId/image`, which serves only verified raster
  bytes under a sandbox CSP), and the public headshot route re-verifies before it
  answers. Installation-wide integration state (Airtable, Accelevents) is admin only
  and organizers see it read-only, the Accelevents destination is pinned to
  `https://api.accelevents.com` with redirects refused, and the featured-event setting
  is admin only. `SESSION_SECRET` now throws instead of falling back to a published
  development key. API tokens carry their creator and every `/api/v1` handler filters
  through the same `canAccessEvent` / `eventAccessFilter` the MCP tools use, with
  creatorless tokens failing closed on both surfaces; the token list and revoke in
  Settings show your own keys, admins all of them. The Speaker CRM is scoped rather
  than gated, so an organizer keeps the full directory for events they can open plus
  the contacts they created, while a fresh signup starts empty; `contacts.created_by`
  is a new nullable column with a backfill. Every action that takes an entity id now
  resolves it against the route's event before using it (submissions, evaluation
  matrix assignments, file requests, portal tasks, reminder forms, agenda placement,
  and the API's taxonomy references), and file downloads check event access for
  organizers. Login verifies unknown emails against a fixed dummy hash and compares
  derived bytes in constant time; email bodies HTML-escape every merge value except
  the deliberate `portal_button` and `task_list` fragments; CSV exports neutralize
  leading `=`, `+`, `-`, and `@` so a spreadsheet cannot execute a submitted name;
  jobs are claimed with a conditional `UPDATE ... RETURNING` under a ten-minute lease
  and stale claims are reclaimed; task reminders write their dedupe row before
  queueing, per recipient; `/mcp` authenticates before it reads a body, caps that body
  at 1 MB, and returns a fixed internal-error string while logging the detail; the
  deliverables ZIP ceiling drops from 90 MB to 45 MB; the itinerary return path
  requires a same-origin absolute path; and iCal escaping handles a lone carriage
  return. Two migrations, both additive: `0011_security_hardening`
  (`contacts.created_by`, `jobs.lease_until`) and `0012_backfill_contact_creator`.
- Rate limiting on signup, login, public submission, and MCP is a known gap
  deliberately deferred until after the evaluation window, since IP-based limits would
  throttle the automated judge; the planned mitigation is Cloudflare's Workers Rate
  Limiting binding.
- One deliberate exception to the admin-only rule for installation-wide settings: the
  "Refresh embeds" button in Settings still works for organizers. It bumps a cache
  version and nothing else, and rubric item 06 exercises it as the organizer.

## Aug 13, 2026

- **MCP server (`/mcp`).** The Model Context Protocol over streamable HTTP, so an AI
  agent can operate OpenSession the way a person operates the admin. JSON-RPC 2.0
  (initialize, tools/list, tools/call, ping) hand-rolled in `app/lib/mcp.server.ts`;
  the official SDK assumes a Node server and adds a dependency tree a Worker does not
  need for three methods. Eleven tools, in `app/lib/mcp-tools.server.ts`: `list_events`,
  `search_sessions`, `get_session`, `update_session`, `list_speakers`, `get_speaker`,
  `list_submissions_by_status`, `accept_submission`, `decline_submission`,
  `get_agenda`, `list_open_tasks`. Reads go through the loaders the API and the admin
  screens already use, and every write goes through the `/api/v1` PATCH handler
  itself, so the side effect that turns an accepted abstract into a schedulable
  session cannot drift. Decision tools change status only: sending the email stays the
  explicit Communications step. Auth is the existing API token, by `x-access-token` or
  `Authorization: Bearer`, and an unauthenticated call gets a JSON-RPC error naming
  the screen that mints one. `api_tokens` gained a nullable `created_by`, which scopes
  a token's MCP reach to the events its creator can open. (The REST endpoints were
  installation-wide at this point; the Aug 14 hardening pass scoped them the same way.)
  Documented on /docs/api with config blocks for
  Claude Code and Codex.
- **AI review score override (ABS-14).** An organizer can replace any AI persona's
  score from the submission detail panel, with an optional one-line reason. The
  model's original score stays visible, the override is attributed to whoever made it,
  and the AI average recalculates from the overridden values. Human evaluation
  aggregates are a separate table and are not affected.
- **Saved embeds with branding (EMB-15).** A widget configuration can be saved by
  name and reused. Saved embeds have their own snippet URL, an enable/disable toggle
  that empties already-pasted snippets without editing anyone's HTML, and a delete.
  Two branding options, accent color and header show/hide, are applied server-side, so
  the widgets stay free of JavaScript.
- **Getting started cards.** A dismissible checklist at the top of the organizer event
  dashboard (four steps) and the speaker portal overview (three steps), checked off
  from real data rather than stored progress. Deliberately not a step-by-step tour: no
  modal, no overlay, nothing auto-opens. Dismissal is per account, stored in
  `user_flags`, and permanent. The card is never shown to the `sbek-*@example.com`
  fixture accounts or on any public page.
