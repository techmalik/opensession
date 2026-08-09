// Generates database/seed.sql: fixture persona accounts (from spec/fixtures-sample-data.json)
// plus a fully populated demo event "Meridian Dev Summit 2027" so human judges see
// filled screens immediately. Idempotent: seed.sql starts by deleting seeded rows.
// Run: node scripts/gen-seed.mjs  (regenerate whenever the schema changes)
import { webcrypto as crypto } from "node:crypto";
import { writeFileSync } from "node:fs";

const ITERATIONS = 100_000;
const b64 = (buf) => Buffer.from(buf).toString("base64");

async function hashPassword(password, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, "base64") : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const ts = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const NOW = ts("2026-08-09T20:00:00Z");

const users = [
  // Eval-kit fixture personas (exact credentials from spec/fixtures-sample-data.json)
  { id: 1, email: "sbek-organizer@example.com", pw: "SbekTest!2027-org", name: "Jordan Alvarez", role: "organizer", contactId: null },
  { id: 2, email: "sbek-speaker@example.com", pw: "SbekTest!2027-spk", name: "Priya Raman", role: "speaker", contactId: 1 },
  { id: 3, email: "sbek-speaker2@example.com", pw: "SbekTest!2027-spk2", name: "Marcus Okafor", role: "speaker", contactId: 2 },
  { id: 4, email: "sbek-reviewer@example.com", pw: "SbekTest!2027-rev", name: "Sam Whitfield", role: "evaluator", contactId: null },
  // Demo accounts for human judges (listed in README and submission form)
  { id: 5, email: "organizer@demo.meridian.dev", pw: "MeridianDemo-org-27", name: "Dana Reeve", role: "organizer", contactId: null },
  { id: 6, email: "reviewer@demo.meridian.dev", pw: "MeridianDemo-rev-27", name: "Kofi Mensah", role: "evaluator", contactId: null },
  { id: 7, email: "speaker@demo.meridian.dev", pw: "MeridianDemo-spk-27", name: "Elena Sorescu", role: "speaker", contactId: 3 },
  { id: 8, email: "admin@demo.meridian.dev", pw: "MeridianDemo-adm-27", name: "Site Admin", role: "admin", contactId: null },
];

const contacts = [
  { id: 1, email: "sbek-speaker@example.com", first: "Priya", last: "Raman", title: "Principal Engineer", company: "Latticework Systems", bio: "Priya Raman is a Principal Engineer at Latticework Systems where she leads the build-tooling platform team." },
  { id: 2, email: "sbek-speaker2@example.com", first: "Marcus", last: "Okafor", title: "Staff Developer Advocate", company: "Cloudreach Labs", bio: "Marcus Okafor is a Staff Developer Advocate at Cloudreach Labs focused on AI agents in production." },
  { id: 3, email: "speaker@demo.meridian.dev", first: "Elena", last: "Sorescu", title: "Engineering Manager", company: "Halcyon Data", bio: "Elena manages the data platform group at Halcyon Data and speaks regularly on schema evolution and streaming systems." },
  { id: 4, email: "tomas.lindgren@meridian.demo", first: "Tomas", last: "Lindgren", title: "SRE Lead", company: "Nordwind", bio: "Tomas runs reliability for Nordwind's edge network." },
  { id: 5, email: "aisha.bello@meridian.demo", first: "Aisha", last: "Bello", title: "Security Engineer", company: "Kestrel Security", bio: "Aisha works on supply-chain security tooling and SBOM automation." },
  { id: 6, email: "ryo.tanaka@meridian.demo", first: "Ryo", last: "Tanaka", title: "Compiler Engineer", company: "Fugu Systems", bio: "Ryo builds incremental compilation pipelines for large TypeScript codebases." },
  { id: 7, email: "mira.house@meridian.demo", first: "Mira", last: "House", title: "Product Engineer", company: "Loamworks", bio: "Mira ships developer onboarding tooling and measures everything." },
  { id: 8, email: "diego.paz@meridian.demo", first: "Diego", last: "Paz", title: "Platform Architect", company: "Sable Cloud", bio: "Diego designs multi-region control planes and writes about platform migrations." },
];

// Demo event content
const EV = 1;
const tracks = ["Infrastructure", "AI Tooling", "Developer Productivity"];
const formats = [
  ["Keynote (45 min)", 45],
  ["Talk (30 min)", 30],
  ["Lightning Talk (10 min)", 10],
  ["Workshop (120 min)", 120],
  ["Panel (45 min)", 45],
];
const rooms = ["Auditorium", "Studio 1", "Studio 2", "Lab"];
const levelNames = ["Beginner", "Intermediate", "Advanced"];
const statusRows = [
  ["pending", "Pending", "#94a3b8", 1],
  ["accept_queue", "Accept Queue", "#0284c7", 2],
  ["accepted", "Accepted", "#0d9166", 3],
  ["decline_queue", "Decline Queue", "#d97706", 4],
  ["declined", "Declined", "#e11d48", 5],
];

const sessionsData = [
  // [title, abstract, track#, format#, level#, status#, submitter contact, isDraft, scheduled?]
  ["Zero-Downtime Schema Migrations at Scale", "A practical playbook for evolving relational schemas under live traffic, with the three rollback patterns that saved us.", 1, 2, 2, 3, 3, 0, ["2027-06-10T17:00:00Z", 45, 1]],
  ["Caching Strategies That Survive Contact With Users", "CDN, edge KV, and application caches interact in ways nobody plans for. A tour of real invalidation bugs and the rules that prevent them.", 1, 2, 2, 3, 4, 0, ["2027-06-10T18:00:00Z", 30, 2]],
  ["Observability on a Budget", "What you actually need from tracing and metrics before series B, and what you can skip without regret.", 3, 3, 1, 3, 7, 0, ["2027-06-10T18:00:00Z", 10, 3]],
  ["Hands-On: Building a Deploy Pipeline From Scratch", "A 2-hour workshop building a production-grade pipeline with preview environments, canaries, and automatic rollback.", 3, 4, 2, 3, 8, 0, ["2027-06-11T16:00:00Z", 120, 4]],
  ["Agentic Code Review in CI", "We put an LLM reviewer in front of 400 weekly PRs. Here is what it catches, what it misses, and the guardrails that made it safe.", 2, 2, 3, 2, 5, 0, null],
  ["SBOMs That Developers Do Not Hate", "Automating software bills of materials so security gets evidence and developers get silence.", 2, 3, 2, 1, 5, 0, null],
  ["The Compiler Is Your Test Suite", "Leaning on incremental type checking to delete half our unit tests, and where that went wrong.", 3, 2, 3, 1, 6, 0, null],
  ["Multi-Region Control Planes Without Tears", "Sequencing a control-plane split across regions: data gravity, failover drills, and the meeting that should have been an ADR.", 1, 2, 3, 4, 8, 0, null],
  ["Onboarding Metrics That Predict Retention", "Which first-week developer behaviors actually predict 6-month retention, from a study of 2,000 hires.", 3, 2, 2, 5, 7, 0, null],
  ["Streaming Joins in Production", "Draft notes on windowing tradeoffs.", 1, 2, 3, 1, 3, 1, null],
  ["Edge Functions vs Regional Workers", "A benchmark-driven comparison of cold starts, tail latency, and cost across four providers.", 1, 2, 2, 1, 4, 0, null],
  ["Prompt Injection Defense in Internal Tools", "Threat model and mitigations for LLM features inside admin dashboards.", 2, 2, 3, 1, 5, 0, null],
];

const main = async () => {
  const lines = [];
  const push = (s) => lines.push(s);

  push("-- Generated by scripts/gen-seed.mjs. Do not edit by hand.");
  push("PRAGMA foreign_keys=OFF;");
  const tables = [
    "users","events","contacts","event_contacts","tracks","formats","levels","tags","rooms","statuses","forms","form_fields","sessions","session_participants","session_tags","eval_plans","eval_criteria","eval_assignments","eval_scores","ai_reviews","portal_tasks","task_completions","file_requests","file_uploads","file_comments","email_templates","email_sends","jobs","airtable_links","api_tokens","settings",
  ];
  for (const t of tables) push(`DELETE FROM ${t};`);

  for (const u of users) {
    const hash = await hashPassword(u.pw, Buffer.from(`salt:${u.email}`).toString("base64"));
    push(
      `INSERT INTO users (id,email,password_hash,name,role,contact_id,created_at) VALUES (${u.id},${q(u.email)},${q(hash)},${q(u.name)},${q(u.role)},${u.contactId ?? "NULL"},${NOW});`
    );
  }

  push(
    `INSERT INTO events (id,name,slug,tagline,description,location,timezone,starts_at,ends_at,status,created_by,created_at) VALUES (${EV},'Meridian Dev Summit 2027','meridian-dev-summit-2027','Systems, tooling, and the people who run them','A two-day, three-track conference for platform and tooling engineers. This is the pre-seeded demo event; the eval agent creates its own event.','Harbourfront Centre, Toronto','America/Toronto',${ts("2027-06-10T13:00:00Z")},${ts("2027-06-11T23:00:00Z")},'active',5,${NOW});`
  );

  for (const c of contacts) {
    push(
      `INSERT INTO contacts (id,email,first_name,last_name,title,company,bio,tags_json,custom_json,created_at,updated_at) VALUES (${c.id},${q(c.email)},${q(c.first)},${q(c.last)},${q(c.title)},${q(c.company)},${q(c.bio)},'[]','{}',${NOW},${NOW});`
    );
    push(`INSERT INTO event_contacts (event_id,contact_id,kind) VALUES (${EV},${c.id},'speaker');`);
  }

  tracks.forEach((t, i) => push(`INSERT INTO tracks (id,event_id,name,color,sort) VALUES (${i + 1},${EV},${q(t)},${q(["#0d9166", "#0284c7", "#7c3aed"][i])},${i});`));
  formats.forEach(([n, d], i) => push(`INSERT INTO formats (id,event_id,name,duration_min,sort) VALUES (${i + 1},${EV},${q(n)},${d},${i});`));
  levelNames.forEach((n, i) => push(`INSERT INTO levels (id,event_id,name,sort) VALUES (${i + 1},${EV},${q(n)},${i});`));
  rooms.forEach((n, i) => push(`INSERT INTO rooms (id,event_id,name,capacity,sort) VALUES (${i + 1},${EV},${q(n)},${[600, 120, 120, 60][i]},${i});`));
  statusRows.forEach(([k, l, c, s], i) => push(`INSERT INTO statuses (id,event_id,key,label,color,is_system,sort) VALUES (${i + 1},${EV},${q(k)},${q(l)},${q(c)},1,${s});`));

  // Published CFP form with conditional field example
  push(
    `INSERT INTO forms (id,event_id,name,slug,type,welcome_html,thank_you_html,opens_at,closes_at,submission_limit,max_speakers,allow_drafts,allow_edit_after_submit,confirmation_subject,confirmation_body,reminder_days_json,status,created_at) VALUES (1,${EV},'Call for Proposals','call-for-proposals','abstract','<p>Meridian Dev Summit brings 800 platform and tooling engineers to Toronto. Tell us what you want to teach them.</p>','<p>Thanks, your proposal is in. We confirm decisions by April 30, 2027.</p>',${ts("2026-08-01T00:00:00Z")},${ts("2027-04-30T23:59:00Z")},3,4,1,1,'We received your proposal for Meridian Dev Summit 2027','<p>Hi {speaker_name},</p><p>We received your proposal "{talk_title}". You can edit it until the CFP closes on April 30, 2027.</p><p>{portal_url}</p>','[5,1]','published',${NOW});`
  );
  const fields = [
    ["session", "title", "Session title", "text", "[]", 1, 1, 0, null],
    ["session", "abstract", "Abstract", "textarea", "[]", 1, 1, 1, null],
    ["session", "track", "Track", "select", JSON.stringify(tracks), 1, 1, 2, null],
    ["session", "format", "Session format", "select", JSON.stringify(formats.map((f) => f[0])), 1, 1, 3, null],
    ["session", "audience_level", "Audience level", "select", JSON.stringify(levelNames), 0, 0, 4, null],
    ["session", "key_takeaway", "Key takeaway", "text", "[]", 1, 0, 5, null],
    ["session", "workshop_prerequisites", "Workshop prerequisites", "textarea", "[]", 0, 0, 6, JSON.stringify({ fieldKey: "format", operator: "equals", value: "Workshop (120 min)" })],
    ["session", "notes_for_reviewers", "Notes for reviewers", "textarea", "[]", 0, 0, 7, null],
    ["speaker", "bio", "Speaker bio", "textarea", "[]", 1, 1, 8, null],
    ["speaker", "company", "Company", "text", "[]", 0, 1, 9, null],
    ["speaker", "dietary", "Dietary requirements", "text", "[]", 0, 0, 10, null],
  ];
  fields.forEach((f, i) =>
    push(
      `INSERT INTO form_fields (id,form_id,section,field_key,label,type,options_json,required,is_system,sort,conditional_json) VALUES (${i + 1},1,${q(f[0])},${q(f[1])},${q(f[2])},${q(f[3])},${q(f[4])},${f[5]},${f[7] != null ? f[6] : f[6]},${f[7]},${f[8] ? q(f[8]) : "NULL"});`
    )
  );

  let sid = 0;
  for (const s of sessionsData) {
    sid += 1;
    const [title, abstract, trackI, formatI, levelI, statusI, submitter, isDraft, sched] = s;
    const scheduled = sched
      ? { starts: ts(sched[0]), ends: ts(sched[0]) + sched[1] * 60, room: sched[2] }
      : { starts: null, ends: null, room: null };
    push(
      `INSERT INTO sessions (id,event_id,friendly_id,title,abstract,is_abstract,is_draft,status_id,form_id,submitted_by,track_id,format_id,level_id,room_id,starts_at,ends_at,answers_json,submitted_at,created_at,updated_at) VALUES (${sid},${EV},'SESS-${1000 + sid}',${q(title)},${q(abstract)},${statusI === 3 ? 0 : 1},${isDraft},${statusI},1,${submitter},${trackI},${formatI},${levelI},${scheduled.room ?? "NULL"},${scheduled.starts ?? "NULL"},${scheduled.ends ?? "NULL"},'{}',${isDraft ? "NULL" : NOW - sid * 3600},${NOW - sid * 7200},${NOW});`
    );
    push(`INSERT INTO session_participants (session_id,contact_id,role,invite_status,sort) VALUES (${sid},${submitter},'speaker','confirmed',0);`);
  }

  // Evaluation plan, assignments for demo reviewer, some scores
  push(
    `INSERT INTO eval_plans (id,event_id,name,round,blind,anonymized,scale_type,max_evals_per_submission,due_at,status,created_at) VALUES (1,${EV},'Round 1 Program Review',1,1,0,'stars5',3,${ts("2027-03-31T23:59:00Z")},'active',${NOW});`
  );
  const assignments = [
    [1, 6, 5, "done", 4, "Strong practical framing and real data. Clear accept for AI Tooling."],
    [2, 6, 6, "done", 3, "Useful topic but the abstract stays high level. Would like specifics on tooling."],
    [3, 6, 7, "pending", null, null],
    [4, 6, 8, "pending", null, null],
    [5, 6, 11, "pending", null, null],
  ];
  for (const [id, evaluator, sess, status, score, comment] of assignments) {
    push(`INSERT INTO eval_assignments (id,plan_id,evaluator_user_id,session_id,status,created_at) VALUES (${id},1,${evaluator},${sess},${q(status)},${NOW});`);
    if (score) push(`INSERT INTO eval_scores (assignment_id,criterion_id,score,comment,created_at) VALUES (${id},NULL,${score},${q(comment)},${NOW});`);
  }

  // Portal tasks (mirrors the fixture task list shape)
  const tasks = [
    ["Confirm participation", "Confirm you will speak at Meridian Dev Summit 2027.", "2027-05-01T23:59:00Z", "accepted_speakers"],
    ["Upload headshot", "A square photo, at least 800px.", "2027-05-10T23:59:00Z", "accepted_speakers"],
    ["Complete bio and profile", "Your bio appears on the public speakers page.", "2027-05-10T23:59:00Z", "all_speakers"],
    ["Upload final slides", "PDF preferred.", "2027-06-01T23:59:00Z", "accepted_speakers"],
    ["Sign speaker release form", "Required before we can record your session.", "2027-05-20T23:59:00Z", "accepted_speakers"],
  ];
  tasks.forEach((t, i) =>
    push(`INSERT INTO portal_tasks (id,event_id,title,description,due_at,applies_to,sort,created_at) VALUES (${i + 1},${EV},${q(t[0])},${q(t[1])},${ts(t[2])},${q(t[3])},${i},${NOW});`)
  );
  push(`INSERT INTO task_completions (task_id,contact_id,status,completed_at) VALUES (3,3,'done',${NOW});`);

  // File request + one pending upload placeholder comment thread
  push(
    `INSERT INTO file_requests (id,event_id,title,instructions,due_at,applies_to,created_at) VALUES (1,${EV},'Final slides','Upload your final slide deck as PDF. We check aspect ratio 16:9.',${ts("2027-06-01T23:59:00Z")},'accepted_speakers',${NOW});`
  );

  // Email templates
  const templates = [
    ["confirmation", "Submission confirmation", "We received your proposal for {event_name}", "<p>Hi {speaker_name},</p><p>We received \"{talk_title}\". You can edit it until the CFP closes.</p>"],
    ["acceptance", "Acceptance", "Your talk has been accepted to {event_name}", "<p>Hi {speaker_name},</p><p>Congratulations. Your session \"{talk_title}\" has been accepted. Please confirm your participation and complete your speaker profile.</p><p>{portal_url}</p>"],
    ["decline", "Decline", "Update on your {event_name} proposal", "<p>Hi {speaker_name},</p><p>Thank you for submitting \"{talk_title}\". We are not able to include it this year. We would love to see you at the event.</p>"],
    ["schedule", "Schedule notice", "Your session is scheduled: {talk_title}", "<p>Hi {speaker_name},</p><p>\"{talk_title}\" is scheduled. A calendar invite is attached.</p>"],
  ];
  templates.forEach((t, i) =>
    push(`INSERT INTO email_templates (id,event_id,key,name,subject,body_html,created_at) VALUES (${i + 1},${EV},${q(t[0])},${q(t[1])},${q(t[2])},${q(t[3])},${NOW});`)
  );

  push(`INSERT INTO settings (key,value_json,updated_at) VALUES ('embed_cache_version','1',${NOW});`);
  push("PRAGMA foreign_keys=ON;");

  writeFileSync(new URL("../database/seed.sql", import.meta.url), lines.join("\n") + "\n");
  console.log(`Wrote database/seed.sql (${lines.length} statements)`);
};

await main();
