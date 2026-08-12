import { createRequestHandler } from "react-router";
import { runJobs, type JobsEnv } from "../app/lib/jobs.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/** Widget responses must be embeddable from any customer site. Anything that
 *  restricts framing is stripped here, at the one place every embed response passes
 *  through, so no individual route can reintroduce it. Only /embed/v1/* is opened up:
 *  every other route keeps whatever framing protection it was given. */
function allowThirdPartyFraming(response: Response): Response {
  const out = new Response(response.body, response);
  out.headers.delete("X-Frame-Options");
  out.headers.set("Content-Security-Policy", "frame-ancestors *");
  return out;
}

export default {
  async fetch(request) {
    // Loaders/actions access bindings via `import { env } from "cloudflare:workers"`.
    const response = await requestHandler(request);
    const { pathname } = new URL(request.url);
    return pathname.startsWith("/embed/v1/") ? allowThirdPartyFraming(response) : response;
  },

  // Outbox job runner: pending jobs (email, airtable_push, airtable_pull, reminder,
  // digest, task_reminder) are claimed and executed every 5 minutes. Failures are
  // recorded per-job in the jobs table; the cron itself never throws.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runJobs(env as unknown as JobsEnv).catch(() => {}));
  },
} satisfies ExportedHandler<Env>;
