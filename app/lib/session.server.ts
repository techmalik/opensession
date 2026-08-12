// Loader/action guards on top of app/lib/auth.ts. auth.ts owns crypto; this file owns
// "who is asking, and are they allowed".

import { redirect } from "react-router";
import { eq } from "drizzle-orm";
import { readSession, type SessionData } from "./auth";
import { getDb, sessionSecret } from "./db.server";
import { users } from "../../database/schema";

export type Role = SessionData["role"];

export interface CurrentUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  contactId: number | null;
}

/** Returns the signed-in user, or null. Never throws. */
export async function getUser(request: Request): Promise<CurrentUser | null> {
  const session = await readSession(request, sessionSecret());
  if (!session) return null;

  const db = getDb();
  const row = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      contactId: users.contactId,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();

  return row ?? null;
}

/** Redirects to /login (preserving where the user was headed) when signed out. */
export async function requireUser(request: Request): Promise<CurrentUser> {
  const user = await getUser(request);
  if (!user) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    throw redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return user;
}

/** Requires one of `roles`. A signed-in user without the role gets 403, not a redirect
 *  loop: they are authenticated, they simply cannot see this. */
export async function requireRole(request: Request, roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser(request);
  if (!roles.includes(user.role)) {
    throw new Response("You do not have access to this area.", { status: 403 });
  }
  return user;
}

/** Organizers and admins run events. Used by every /admin route. */
export function requireOrganizer(request: Request): Promise<CurrentUser> {
  return requireRole(request, ["admin", "organizer"]);
}

/** The role from the signed cookie, with no database round trip. Public pages use
 *  this to decide between a "Sign in" link and a link back into the app; they must
 *  not pay for a user lookup on a page most visitors read logged out. */
export async function getSessionRole(request: Request): Promise<Role | null> {
  const session = await readSession(request, sessionSecret());
  return session?.role ?? null;
}
