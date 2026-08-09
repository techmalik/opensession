# Phase 2: CFP forms + submissions + abstract review (40 rubric points)

Suggested run: Opus, high effort for step A and C; Sonnet is fine for step B if you are watching usage.

## A. Form builder + public submission (spec/specs/01-call-for-papers.yaml)

Read spec/docs/01-call-for-papers.md and the full CFP yaml first.

Build: Forms list, form editor (welcome text, thank-you text, open/close dates, submission limit, max speakers, drafts toggle, confirmation email subject/body), field builder (add/edit/reorder/required toggle for all types in form_fields; options editor for selects; conditional rule editor: show when [field] [equals] [value]). Public portal at /submit/:eventSlug/:formSlug: logged-out shows event name, dates, deadline, welcome text, Start submission; signup/login inline; multi-step (session fields, speakers step supporting co-speakers up to max, review step); client-side conditional visibility WITHOUT page reload; server-side validation mirroring required flags; drafts (Save draft button when enabled); submit -> friendly ID, thank-you screen, confirmation email via sendEmail, redirect into portal view of the submission; editing allowed until close when the toggle is on; CLOSED form: public page states closed and server rejects POST (the spec tests this). Submission limit enforced per submitter with a clear message.

## B. Submissions table (organizer)

Dense table per DESIGN.md: columns ID, title, speakers, track, format, status badge, score avg, submitted date. Search, filter by status/track/format, saved filter chips, bulk select -> move to Accept Queue / Decline Queue / set status, CSV export of current filter. Row click -> submission detail: all answers, speakers, status dropdown, activity, evaluations summary, files. Manual "Add submission" for organizer.

## C. Evaluations (spec/specs/02-abstract-management.yaml, read spec/docs/02-abstract-management.md)

Evaluation plans CRUD (name, round, blind toggle, anonymized toggle, scale stars5 or weighted rubric criteria, max evals per submission, due date). Assignment UI: pick evaluators (users with evaluator role, invite-by-email creates account with temp password shown once), auto-distribute N per submission or manual matrix. Evaluator dashboard /review: my queue with progress, score + comment form, next-unscored flow. Blind: evaluator NEVER sees other scores; anonymized hides speaker identities. Organizer aggregate: avg score, count, per-evaluator breakdown, sort by score. Accept Queue / Decline Queue screens with "Send N decision emails" button using templates, recording decisionEmailSentAt, sessions with sent decisions get is_abstract=0 when accepted (they become sessions). Multi-round: round 2 plan can filter to submissions above a score threshold.

Keep typecheck and build green; update seed so the demo event shows a plan with mixed done/pending assignments; end by listing rubric IDs satisfied.
