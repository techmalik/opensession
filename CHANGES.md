# Changes since competition submission (Aug 13, 2026)

OpenSession was submitted to the Kill My SaaS competition on August 13, 2026, and
scored 94.5% on the sbek eval kit at that point. Work continued after the deadline.
Everything below landed afterwards and is listed here so the submitted state and the
current state are easy to tell apart.

Every change is additive. No route was renamed, moved, or removed, no migration
altered an existing column, and the paths the eval agent exercises (sign in, the
public call for papers, the embed widgets) behave exactly as they did at submission.

## Aug 13, 2026

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
