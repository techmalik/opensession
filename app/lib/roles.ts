// Client-safe role helpers. Both the login form and the demo buttons decide where
// to send someone, so the rule lives in one place.

export type RoleName = "admin" | "organizer" | "evaluator" | "speaker";

export function landingFor(role: string): string {
  if (role === "admin" || role === "organizer") return "/admin";
  if (role === "evaluator") return "/review";
  return "/portal";
}

/** The event seed.sql ships. The seeded demo accounts keep access to it after an
 *  event became something only its creator can open, because it is nobody's event in
 *  particular and the landing page signs strangers straight into it. */
export const DEMO_EVENT_SLUG = "meridian-dev-summit-2027";

/** The three accounts the landing page can sign into without a password. This list
 *  is the whole security boundary for that feature: the demo route will not sign in
 *  as anyone whose email is not one of these, whatever it is sent. */
export const DEMO_ACCOUNTS: { key: string; email: string; label: string; blurb: string }[] = [
  {
    key: "organizer",
    email: "organizer@demo.meridian.dev",
    label: "Explore as organizer",
    blurb: "Submissions, agenda, speakers, embeds",
  },
  {
    key: "reviewer",
    email: "reviewer@demo.meridian.dev",
    label: "Explore as reviewer",
    blurb: "Score the abstracts assigned to you",
  },
  {
    key: "speaker",
    email: "speaker@demo.meridian.dev",
    label: "Explore as speaker",
    blurb: "Your sessions, tasks, and files",
  },
];

export function demoAccountFor(key: string) {
  return DEMO_ACCOUNTS.find((account) => account.key === key) ?? null;
}

/** Plaintext logins for the same demo event, for anyone who wants to type a
 *  specific login rather than use the one-click buttons. Passwords match README.md;
 *  update both places together if they ever change. */
export const DEMO_CREDENTIALS: { role: string; email: string; password: string }[] = [
  { role: "Organizer", email: "organizer@demo.meridian.dev", password: "MeridianDemo-org-27" },
  { role: "Reviewer", email: "reviewer@demo.meridian.dev", password: "MeridianDemo-rev-27" },
  { role: "Speaker", email: "speaker@demo.meridian.dev", password: "MeridianDemo-spk-27" },
  { role: "Admin", email: "admin@demo.meridian.dev", password: "MeridianDemo-adm-27" },
];

/** What to call the role's home in navigation. Pairs with landingFor: one decides
 *  where the link goes, the other what it is called. */
export function homeLabelFor(role: string): string {
  if (role === "admin" || role === "organizer") return "Organizer";
  if (role === "evaluator") return "Review";
  return "Speaker portal";
}

/** True for the seeded demo logins, one-click or typed. Used only to keep them on the
 *  demo event: it grants nothing anywhere else. */
export function isDemoAccountEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return (
    DEMO_ACCOUNTS.some((account) => account.email === normalized) ||
    DEMO_CREDENTIALS.some((account) => account.email === normalized)
  );
}
