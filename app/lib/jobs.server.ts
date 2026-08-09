// Outbox job runner, invoked by the Worker's scheduled() cron every 5 minutes.
// Claims up to 25 due jobs and executes by kind. Each handler must be idempotent.
// Phase 4 fills in the handlers; the runner loop is final.

import { drizzle } from "drizzle-orm/d1";
import { and, eq, lte } from "drizzle-orm";
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
  email: async () => {
    // Phase 4: deliver queued email_sends rows via app/lib/email.ts
  },
  airtable_push: async () => {
    // Phase 4: push changed rows to Airtable (airtable_links tracks record mapping)
  },
  airtable_pull: async () => {
    // Phase 4: pull team edits from Airtable back into D1
  },
  reminder: async () => {
    // Phase 4: CFP close reminders (5 days / 1 day, from forms.reminder_days_json)
  },
  digest: async () => {
    // Phase 4: weekly speaker digest
  },
};

export async function runJobs(env: JobsEnv): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();
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
