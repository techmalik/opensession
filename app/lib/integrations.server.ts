// Recurring integration work, expressed as job rows. The runner calls this once per
// tick; the hour bucket in each payload makes "one push per hour" idempotent without
// any extra bookkeeping.

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { airtableConfigured, type AirtableEnv } from "./airtable.server";
import { accelConfigured, accelState } from "./accelevents.server";
import { jobs } from "../../database/schema";

export type IntegrationJobKind = "airtable_push" | "airtable_pull" | "accelevents_push";

function hourBucket(now: Date): string {
  return now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

async function ensureHourlyJob(db: D1Database, kind: IntegrationJobKind, now: Date): Promise<boolean> {
  const orm = drizzle(db);
  const payloadJson = JSON.stringify({ hour: hourBucket(now) });
  const existing = await orm
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, kind), eq(jobs.payloadJson, payloadJson)))
    .get();
  if (existing) return false;
  await orm.insert(jobs).values({ kind, payloadJson, runAfter: now, createdAt: new Date() });
  return true;
}

export async function ensureIntegrationJobs(env: AirtableEnv, now = new Date()): Promise<string[]> {
  const created: string[] = [];

  if (airtableConfigured(env)) {
    if (await ensureHourlyJob(env.DB, "airtable_push", now)) created.push("airtable_push");
    if (await ensureHourlyJob(env.DB, "airtable_pull", now)) created.push("airtable_pull");
  }

  const accel = await accelState();
  if (accel.config.enabled && accelConfigured(accel)) {
    if (await ensureHourlyJob(env.DB, "accelevents_push", now)) created.push("accelevents_push");
  }

  return created;
}
