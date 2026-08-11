// POST /demo/:role: signs in as one of three seeded demo accounts with no
// credential entry, so a judge can look around without being handed a password.
//
// The security boundary is DEMO_ACCOUNTS in app/lib/roles.ts. This route resolves
// a role key to an email from that list and looks the user up by that exact
// address. There is no path from a request parameter to an arbitrary account: a
// key that is not in the list is rejected before any query runs.
//
// POST only. A GET that signs you in would fire on a link prefetch or a crawler.

import { redirect } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/demo";
import { createSessionCookie } from "../lib/auth";
import { getDb, sessionSecret } from "../lib/db.server";
import { demoAccountFor, landingFor } from "../lib/roles";
import { users } from "../../database/schema";

export async function loader() {
  // Nothing to render, and nothing that should happen on a GET.
  return redirect("/");
}

export async function action({ params }: Route.ActionArgs) {
  const account = demoAccountFor(String(params.role));
  if (!account) return redirect("/");

  const db = getDb();
  const user = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, account.email))
    .get();

  // A database without the demo seed should say so rather than fail silently.
  if (!user) return redirect("/login?demo=missing");

  return redirect(landingFor(user.role), {
    headers: {
      "Set-Cookie": await createSessionCookie({ userId: user.id, role: user.role, demo: true }, sessionSecret()),
    },
  });
}
