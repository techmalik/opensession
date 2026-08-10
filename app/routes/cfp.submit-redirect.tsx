// /cfp/:eventSlug/submit predates the real portal URL. It now forwards to the live
// form at /submit/:eventSlug/:formSlug so any recorded link keeps working.

import { redirect } from "react-router";
import { and, asc, eq } from "drizzle-orm";
import type { Route } from "./+types/cfp.submit-redirect";
import { getDb } from "../lib/db.server";
import { events, forms } from "../../database/schema";

export async function loader({ params }: Route.LoaderArgs) {
  const db = getDb();
  const event = await db
    .select({ id: events.id, slug: events.slug })
    .from(events)
    .where(and(eq(events.slug, params.eventSlug), eq(events.status, "active")))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const form = await db
    .select({ slug: forms.slug })
    .from(forms)
    .where(and(eq(forms.eventId, event.id), eq(forms.type, "abstract"), eq(forms.status, "published")))
    .orderBy(asc(forms.closesAt))
    .get();
  if (!form) throw redirect(`/cfp/${event.slug}`);

  throw redirect(`/submit/${event.slug}/${form.slug}`);
}
