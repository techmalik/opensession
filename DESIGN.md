# OpenSession design system

This file is law. Any UI that violates it gets rewritten. The goal is a product a
professional events team would pay for: quiet, dense, fast, trustworthy. Reference
points: Linear, Stripe Dashboard, Notion. Anti-reference: generic AI-generated
landing pages.

## Forbidden (hard rules)

- No purple/violet/indigo gradients. No gradients as decoration anywhere. Flat color only.
- No glassmorphism, no frosted blur cards, no floating 3D blobs, no sparkle or magic-wand icons.
- No emoji in UI copy, headings, buttons, or empty states.
- No em dashes in any copy. Use commas, colons, or separate sentences.
- No hype copy: never "supercharge", "seamless", "effortless", "unleash", "revolutionize",
  "next-generation", "AI-powered magic". Describe what a thing does in plain words.
- No oversized hero sections in the admin app. The admin is a tool, not a brochure.
- No skeleton shimmer theater. If data loads under 200ms, render it; otherwise a plain
  single-line loading state.
- No more than 2 font weights per screen. No letter-spacing tricks on body text.
- No colored button zoo: one primary button per view, everything else secondary/ghost.

## Tokens

- Font: Inter (self-hosted via @fontsource-variable/inter). Mono: ui-monospace for IDs.
- Type scale: 12 (meta), 13 (table body), 14 (body/base), 16 (section titles), 20 (page
  titles), 28 (public pages only). Line heights tight: 1.4 body, 1.2 headings.
- Neutrals: Tailwind slate. Page bg white; app chrome bg slate-50; borders slate-200;
  body text slate-900; secondary text slate-500.
- Accent: green #0d9166 (darkened from Sessionboard's #45cc93 for AA contrast on white).
  Used for: primary buttons, active nav item, focus rings, links. Nothing else.
- Status colors, fixed: pending slate-400, accept queue sky-600, accepted green #0d9166,
  decline queue amber-600, declined rose-600. Rendered as small dot + label badges,
  never full-width colored rows.
- Radius: 6px controls, 8px cards. Shadows: shadow-sm only. Dark mode: not in scope
  before submission; do not half-ship it.

## Layout

- Admin shell: fixed 232px left sidebar (event switcher on top, nav groups: Dashboard,
  Program [Submissions, Forms, Evaluations, Agenda, Speakers], Contacts, Portals,
  Communications, Embeds, Settings), content area max-w-none with 24px padding.
- Tables are the product. Dense rows (40px), sticky header, left-aligned text, right-
  aligned numbers, row hover bg-slate-50, checkbox column for bulk actions, toolbar
  above with search input, filter dropdowns, and a CSV export button on the right.
  Every table gets: search, at least one filter, bulk select, CSV export. No exceptions.
- Forms: single column, 640px max width, labels above inputs, 13px help text below,
  required marked with a plain asterisk. Validation errors inline in rose-600 text
  under the field plus a summary at top on submit.
- Public pages (CFP form, speaker portal, embeds): centered column, max 720px, 16px
  base font, generous touch targets (44px min), work perfectly at 375px width.
- Empty states: one sentence + one primary action button. No illustrations.

## Copy voice

Short, specific, lowercase-calm. "Form closed Apr 30, 2027" not "This form is no longer
accepting submissions!". Buttons are verbs: "Publish form", "Send decision emails",
"Export CSV". Error messages say what happened and what to do next. Confirmation
dialogs state the consequence: "This emails 14 speakers. Send now?"

## Interaction

- Server-rendered first paint. Optimistic UI for status changes and checkbox toggles.
- Focus visible everywhere (accent ring). All actions keyboard reachable.
- Destructive actions get a confirm step showing the blast radius count.
- Never trap the user: every detail view has a breadcrumb back to its table.
