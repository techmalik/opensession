# Changes since competition submission (Aug 13, 2026)

OpenSession was submitted to the Kill My SaaS competition on August 13, 2026, and
scored 94.5% on the sbek eval kit at that point. Work continued after the deadline.
Everything below landed afterwards and is listed here so the submitted state and the
current state are easy to tell apart.

Every change is additive. No route was renamed, moved, or removed, no migration
altered an existing column, and the paths the eval agent exercises (sign in, the
public call for papers, the embed widgets) behave exactly as they did at submission.

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
  a token's MCP reach to the events its creator can open; the REST endpoints are
  untouched and stay installation-wide. Documented on /docs/api with config blocks for
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
