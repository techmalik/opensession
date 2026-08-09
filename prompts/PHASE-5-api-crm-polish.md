# Phase 5: Public API bonus, Speaker CRM extra credit, AI reviews, polish

Suggested run: Sonnet medium for API CRUD; Opus high for CRM only if time is healthy.

## A. Public API (bonus): Sessionboard-compatible subset

Under /api/v1 with x-access-token header auth against api_tokens (Settings > API: create token, show once, hash stored). Endpoints: GET /api/v1/events; POST /api/v1/event/:eventId/sessions (search: filters status/track/format/text, sort, page, pageSize, expand=speakers); GET/POST/PATCH/DELETE /api/v1/event/:eventId/session/:id; GET /api/v1/event/:eventId/statuses|tracks|formats|rooms|tags; GET/POST /api/v1/event/:eventId/contacts; GET /api/v1/event/:eventId/speakers/search?q=. JSON errors {error, message}, 401 without token, per-token lastUsedAt. /docs/api: static reference page listing each endpoint with curl examples (DESIGN.md styling, public).

## B. AI evaluators (brief item 4)

On submission detail and bulk from the submissions table: "Run AI review" with 3 personas (Track expert, Audience advocate, Skeptic). Uses Workers AI (fallback ANTHROPIC_API_KEY, else template heuristic scoring by abstract length/specificity with an honest label "heuristic"). Output: score 1-5 + 3-sentence cited review stored in ai_reviews, shown in a distinct "AI reviews" panel clearly separated from human scores, never counted in human aggregates.

## C. Speaker CRM (extra credit, spec/specs/07-speaker-crm.yaml, only when required areas are green)

Org-level Contacts area (outside event nav): all contacts across events, search, tag editor, rating stars, notes, segments (saved filters), session history per contact across events, CSV smart import (auto-map headers, dedupe by email with merge preview), bulk add-to-event as speakers, export.

## D. Polish pass (Wednesday)

- Command palette (Cmd+K): jump to session/speaker/screen.
- Keyboard triage on submissions table: j/k move, a accept-queue, d decline-queue.
- Empty states per DESIGN.md everywhere; loading states audit; error boundary copy.
- Lighthouse: public form, portal, embeds. Fix anything under 90 performance. Record numbers for README.
- Mobile audit at 375px: public form, portal, all five widgets.
- README rewrite per plan section 11: architecture, requirement -> screen map, seeded logins, self-hosting, measured performance, honest limitations.
