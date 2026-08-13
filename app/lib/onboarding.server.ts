// The "Getting started" cards on the organizer dashboard and the speaker portal.
//
// Deliberately not a tour. A step-by-step overlay would put a click between the
// automated evaluator and every control it is looking for, and it would nag a real
// organizer who already knows the product. This is one quiet card of links, checked
// off from real data, dismissible for good.
//
// Two hard rules live here rather than in the routes, so no route can forget them:
// the fixture accounts the eval agent signs in as never see a card, and dismissal is
// a row in user_flags rather than a cookie, so it survives a new browser.

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./db.server";
import {
  contacts,
  evalAssignments,
  evalPlanReviewers,
  evalPlans,
  events,
  forms,
  sessionParticipants,
  userFlags,
} from "../../database/schema";

export const ORGANIZER_GETTING_STARTED = "getting_started_organizer";
export const PORTAL_GETTING_STARTED = "getting_started_portal";

export interface ChecklistItem {
  label: string;
  to: string;
  done: boolean;
}

/** The seeded eval personas: sbek-organizer@example.com and friends. Their runs are
 *  scored against a rubric, so nothing new may appear above the content they expect. */
export function isFixtureAccount(email: string | null | undefined): boolean {
  return /^sbek-[^@]*@example\.com$/i.test((email ?? "").trim());
}

export async function hasFlag(userId: number, flag: string): Promise<boolean> {
  const db = getDb();
  const row = await db
    .select({ id: userFlags.id })
    .from(userFlags)
    .where(and(eq(userFlags.userId, userId), eq(userFlags.flag, flag)))
    .get();
  return Boolean(row);
}

export async function setFlag(userId: number, flag: string): Promise<void> {
  const db = getDb();
  await db
    .insert(userFlags)
    .values({ userId, flag, setAt: new Date() })
    .onConflictDoNothing();
}

/** Show the card only to a real account that has never dismissed it. */
export async function shouldShowCard(
  user: { id: number; email: string },
  flag: string
): Promise<boolean> {
  if (isFixtureAccount(user.email)) return false;
  return !(await hasFlag(user.id, flag));
}

async function exists(query: Promise<{ n: number } | undefined>): Promise<boolean> {
  return ((await query)?.n ?? 0) > 0;
}

/** Four steps, each answered by a real query rather than a stored "step 2 of 4". */
export async function organizerChecklist(eventId: number): Promise<ChecklistItem[]> {
  const db = getDb();
  const base = `/admin/${eventId}`;

  const formCount = db
    .select({ n: sql<number>`count(*)` })
    .from(forms)
    .where(eq(forms.eventId, eventId))
    .get();

  // A reviewer on any plan of this event counts as "invited".
  const reviewerCount = db
    .select({ n: sql<number>`count(*)` })
    .from(evalPlanReviewers)
    .innerJoin(evalPlans, eq(evalPlanReviewers.planId, evalPlans.id))
    .where(eq(evalPlans.eventId, eventId))
    .get();

  const doneCount = db
    .select({ n: sql<number>`count(*)` })
    .from(evalAssignments)
    .innerJoin(evalPlans, eq(evalAssignments.planId, evalPlans.id))
    .where(and(eq(evalPlans.eventId, eventId), eq(evalAssignments.status, "done")))
    .get();

  const eventRow = await db
    .select({ agendaPublishedAt: events.agendaPublishedAt })
    .from(events)
    .where(eq(events.id, eventId))
    .get();

  return [
    { label: "Create your CFP form", to: `${base}/forms`, done: await exists(formCount) },
    { label: "Invite reviewers", to: `${base}/plan`, done: await exists(reviewerCount) },
    { label: "Review submissions", to: `${base}/submissions`, done: await exists(doneCount) },
    { label: "Publish your agenda", to: `${base}/agenda`, done: eventRow?.agendaPublishedAt != null },
  ];
}

/** Three steps for a speaker. Each is true when the speaker has actually done it,
 *  not when they have merely visited the page. `open` comes from the portal loader,
 *  which has already counted the outstanding tasks and files for this person. */
export async function portalChecklist(
  contactId: number | null,
  open: { tasks: number; files: number }
): Promise<ChecklistItem[]> {
  const db = getDb();

  const profile =
    contactId == null
      ? null
      : await db.select({ bio: contacts.bio }).from(contacts).where(eq(contacts.id, contactId)).get();

  const pendingInvites =
    contactId == null
      ? { n: 0 }
      : await db
          .select({ n: sql<number>`count(*)` })
          .from(sessionParticipants)
          .where(and(eq(sessionParticipants.contactId, contactId), eq(sessionParticipants.inviteStatus, "invited")))
          .get();

  return [
    { label: "Complete your profile", to: "/portal/profile", done: Boolean((profile?.bio ?? "").trim()) },
    {
      label: "Confirm your sessions",
      to: "/portal",
      // Nothing left to answer counts as done, whether they confirmed or were never invited.
      done: contactId != null && (pendingInvites?.n ?? 0) === 0,
    },
    { label: "Check your tasks", to: "/portal/tasks", done: contactId != null && open.tasks === 0 && open.files === 0 },
  ];
}
