import { createRequestHandler } from "react-router";
import { runJobs, type JobsEnv } from "../app/lib/jobs.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request) {
    // Loaders/actions access bindings via `import { env } from "cloudflare:workers"`.
    return requestHandler(request);
  },

  // Outbox job runner: pending jobs (email, airtable_push, airtable_pull, reminder,
  // digest) are claimed and executed every 5 minutes. Failures are recorded per-job
  // in the jobs table; the cron itself never throws.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runJobs(env as unknown as JobsEnv).catch(() => {}));
  },
} satisfies ExportedHandler<Env>;
