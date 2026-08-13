// Account and contact creation shared by signup, the public CFP inline signup, and
// evaluator invites. Speakers always get a contact row: submissions, portals, and the
// CRM key off it.

import { eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { hashPassword } from "./auth";
import { contacts, users } from "../../database/schema";

export function splitName(name: string): { firstName: string; lastName: string } {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName: firstName ?? "", lastName: rest.join(" ") };
}

export async function findOrCreateContact(input: {
  email: string;
  name: string;
  title?: string | null;
  company?: string | null;
  bio?: string | null;
  /** The signed-in user entering this person, when there is one. Half of the CRM
   *  visibility rule; null for public self-service paths, which link to an event. */
  createdBy?: number | null;
}): Promise<number> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const existing = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, email)).get();
  if (existing) return existing.id;

  const now = new Date();
  const { firstName, lastName } = splitName(input.name);
  const created = await db
    .insert(contacts)
    .values({
      email,
      firstName,
      lastName,
      title: input.title ?? null,
      company: input.company ?? null,
      bio: input.bio ?? null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: contacts.id })
    .get();
  return created.id;
}

export interface CreateAccountResult {
  userId: number;
  contactId: number | null;
  error?: undefined;
}

/** Creates a user account. Returns { error } instead of throwing when the email is
 *  taken, so callers can render an inline message. */
export async function createAccount(input: {
  name: string;
  email: string;
  password: string;
  role: "organizer" | "evaluator" | "speaker";
}): Promise<CreateAccountResult | { error: string }> {
  const db = getDb();
  const email = input.email.trim().toLowerCase();

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (existing) return { error: "An account with that email already exists." };

  const contactId = input.role === "speaker" ? await findOrCreateContact({ email, name: input.name }) : null;
  const created = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword(input.password),
      name: input.name.trim(),
      role: input.role,
      contactId,
      createdAt: new Date(),
    })
    .returning({ id: users.id })
    .get();

  return { userId: created.id, contactId };
}

/** 14 characters, mixed alphabet, from WebCrypto. Shown once on screen for invites. */
export function generateTempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
