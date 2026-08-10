// Outbox job runner, invoked by the Worker's scheduled() cron every 5 minutes.
// Claims up to 25 due jobs and executes by kind. Each handler must be idempotent.
// Phase 4 fills in the handlers; the runner loop is final.

import { drizzle } from "drizzle-orm/d1";
import { and, eq, lte } from "drizzle-orm";
import { deliverEmail } from "./email";
import { jobs } from "../../database/schema";

export interface JobsEnv {
  DB: D1Database;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  AIRTABLE_API_KEY?: string;
  AIRTABLE_BASE_ID?: string;
  APP_BASE_URL?: string;
}

type Handler = (env: JobsEnv, payload: Record<string, unknown>) => Promise<void>;

const handlers: Record<string, Handler> = {
  // Payload: { sendId, ics }. The email_sends row already exists; this delivers it.
  email: async (env, payload) => {
    const sendId = Number(payload.sendId);
    if (!Number.isInteger(sendId)) throw new Error("email job has no sendId");
    const ics = payload.ics as { filename: string; content: string } | null | undefined;
    const status = await deliverEmail(env, sendId, ics ?? undefined);
    if (status === "failed") throw new Error(`delivery failed for send ${sendId}`);
  },
  // Payload: {}. Pushes every changed local row to Airtable.
  airtable_push: async (env) => {
    const { pushToAirtable } = await import("./airtable.server");
    await pushToAirtable(env);
  },
  // Payload: {}. Pulls records changed in Airtable back into D1.
  airtable_pull: async (env) => {
    const { pullFromAirtable } = await import("./airtable.server");
    await pullFromAirtable(env);
  },
  // Payload: { formId, days }. CFP close reminder, scheduled off reminder_days_json.
  reminder: async (_env, payload) => {
    const { sendFormReminders } = await import("./notifications.server");
    await sendFormReminders(Number(payload.formId), Number(payload.days ?? 0));
  },
  // Payload: { eventId, week }. Weekly summary to opted-in speakers.
  digest: async (_env, payload) => {
    const { sendSpeakerDigest } = await import("./notifications.server");
    await sendSpeakerDigest(Number(payload.eventId));
  },
  // Payload: {}. Hourly Accelevents push, only when the integration is enabled.
  accelevents_push: async (env) => {
    const { pushToAccelevents } = await import("./accelevents.server");
    await pushToAccelevents(env);
  },
};

export async function runJobs(env: JobsEnv): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  // Turn recurring intentions (form reminder offsets, the weekly digest, the hourly
  // integration pushes) into dated rows before claiming work. Idempotent per payload.
  try {
    const { ensureScheduledJobs } = await import("./notifications.server");
    await ensureScheduledJobs(now);
    const { ensureIntegrationJobs } = await import("./integrations.server");
    await ensureIntegrationJobs(env, now);
  } catch (err) {
    console.warn("job scheduling sweep failed", err);
  }

  const due = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAfter, now)))
    .limit(25);

  for (const job of due) {
    await db.update(jobs).set({ status: "running", attempts: job.attempts + 1 }).where(eq(jobs.id, job.id));
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Error(`No handler for kind ${job.kind}`);
      await handler(env, JSON.parse(job.payloadJson) as Record<string, unknown>);
      await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, job.id));
    } catch (err) {
      const failed = job.attempts + 1 >= 5;
      await db
        .update(jobs)
        .set({
          status: failed ? "failed" : "pending",
          lastError: String(err).slice(0, 500),
          runAfter: new Date(Date.now() + Math.min(60_000 * 2 ** job.attempts, 3_600_000)),
        })
        .where(eq(jobs.id, job.id));
    }
  }
}
