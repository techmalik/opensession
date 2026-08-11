// Client-safe role helpers. Both the login form and the demo buttons decide where
// to send someone, so the rule lives in one place.

export type RoleName = "admin" | "organizer" | "evaluator" | "speaker";

export function landingFor(role: string): string {
  if (role === "admin" || role === "organizer") return "/admin";
  if (role === "evaluator") return "/review";
  return "/portal";
}

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
