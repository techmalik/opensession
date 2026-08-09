# Eval-report fix loop (run after each sbek run)

Suggested run: Opus high effort. Paste report findings, not the whole HTML.

Prompt to paste (attach or paste the failing items from runs/<ts>/report.json):

Here are the failed, not_found, and partial rubric items from the LLM judge run against production, plus the judge's defect list. For each item: reproduce against local seed data, fix the smallest way, and note the fix next to the rubric ID. Priority order: type roundtrip, then rule, then scoping, then everything else. cannot_judge items mean the agent could not reach the flow: treat those as navigation/speed problems and reduce the clicks to reach that flow. Do not refactor anything currently passing. Keep typecheck and build green. Finish with a table: rubric ID, verdict before, root cause, fix.
