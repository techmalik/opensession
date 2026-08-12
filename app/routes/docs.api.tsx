// Public, no-auth API reference at /docs/api. Every endpoint listed here exists,
// and every example is a request you can paste.

import { Link } from "react-router";
import type { Route } from "./+types/docs.api";
import { appBaseUrl } from "../lib/db.server";
import { getSessionRole } from "../lib/session.server";
import { PublicHeader } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [
    { title: "API | OpenSession" },
    { name: "description", content: "Reference for the OpenSession public API." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  return { baseUrl: appBaseUrl(), role: await getSessionRole(request) };
}

interface Endpoint {
  method: string;
  path: string;
  description: string;
  example: (base: string) => string;
}

const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/v1/events",
    description: "List events, newest first.",
    example: (base) => `curl -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/events?page=1&pageSize=25"`,
  },
  {
    method: "GET",
    path: "/api/v1/event/:eventId",
    description: "One event, with submission, session, and public counts.",
    example: (base) => `curl -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/event/1"`,
  },
  {
    method: "POST",
    path: "/api/v1/event/:eventId/sessions",
    description:
      "Search sessions. Filters go in the body: q, status, track, format, room, publicState, isAbstract, isDraft, scheduled.",
    example: (base) =>
      `curl -X POST -H "x-access-token: $TOKEN" -H "content-type: application/json" \\\n` +
      `  -d '{"q":"caching","status":"accepted","page":1,"pageSize":10}' \\\n` +
      `  "${base}/api/v1/event/1/sessions"`,
  },
  {
    method: "GET",
    path: "/api/v1/event/:eventId/sessions",
    description: "The same collection without a body, for a plain paginated list.",
    example: (base) => `curl -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/event/1/sessions?pageSize=5"`,
  },
  {
    method: "POST",
    path: "/api/v1/event/:eventId/sessions",
    description: 'Create a session. A body carrying "create" is a write rather than a search.',
    example: (base) =>
      `curl -X POST -H "x-access-token: $TOKEN" -H "content-type: application/json" \\\n` +
      `  -d '{"create":{"title":"Observability on a Budget","abstract":"What you actually need.","trackId":3}}' \\\n` +
      `  "${base}/api/v1/event/1/sessions"`,
  },
  {
    method: "GET",
    path: "/api/v1/event/:eventId/sessions/:sessionId",
    description: "One session with its speakers, track, format, room, and schedule.",
    example: (base) => `curl -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/event/1/sessions/1"`,
  },
  {
    method: "PATCH",
    path: "/api/v1/event/:eventId/sessions/:sessionId",
    description:
      "Update a session. Accepts title, abstract, trackId, formatId, levelId, roomId, startsAt, endsAt, isDraft, publicState, and status or statusId.",
    example: (base) =>
      `curl -X PATCH -H "x-access-token: $TOKEN" -H "content-type: application/json" \\\n` +
      `  -d '{"status":"accepted","roomId":1,"startsAt":"2027-06-10T17:00:00Z","endsAt":"2027-06-10T17:45:00Z"}' \\\n` +
      `  "${base}/api/v1/event/1/sessions/1"`,
  },
  {
    method: "DELETE",
    path: "/api/v1/event/:eventId/sessions/:sessionId",
    description: "Delete a session and its speaker links.",
    example: (base) => `curl -X DELETE -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/event/1/sessions/42"`,
  },
  {
    method: "GET",
    path: "/api/v1/event/:eventId/contacts",
    description: "Everyone on the event: roster members and anyone on a session.",
    example: (base) => `curl -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/event/1/contacts"`,
  },
  {
    method: "GET",
    path: "/api/v1/event/:eventId/statuses",
    description: "Decision statuses, with their system keys.",
    example: (base) => `curl -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/event/1/statuses"`,
  },
  {
    method: "GET",
    path: "/api/v1/event/:eventId/tracks",
    description: "Tracks, in display order.",
    example: (base) => `curl -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/event/1/tracks"`,
  },
  {
    method: "GET",
    path: "/api/v1/event/:eventId/formats",
    description: "Formats, with their default durations.",
    example: (base) => `curl -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/event/1/formats"`,
  },
  {
    method: "GET",
    path: "/api/v1/event/:eventId/rooms",
    description: "Rooms, with capacities.",
    example: (base) => `curl -H "x-access-token: $TOKEN" \\\n  "${base}/api/v1/event/1/rooms"`,
  },
];

function Block({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-900">
      {children}
    </pre>
  );
}

export default function ApiDocs({ loaderData }: Route.ComponentProps) {
  const { baseUrl, role } = loaderData;

  return (
    <>
      <PublicHeader role={role} width="max-w-[820px]" />
      <main className="mx-auto w-full max-w-[820px] px-6 py-16">
        <p className="text-[13px] font-medium tracking-wide text-slate-500">Reference</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">API</h1>
        <p className="mt-2 text-base leading-relaxed text-slate-500">
          A JSON API under <code className="font-mono text-[15px]">/api/v1</code>, authenticated with an{" "}
          <code className="font-mono text-[15px]">x-access-token</code> header. No cookie, no session: a token is the whole
          credential.
        </p>

        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">Getting a token</h2>
          <p className="mt-1 text-base leading-relaxed text-slate-900">
            Create one in an event's admin under Settings, API. The token is shown once, at creation. Only its hash is
            stored, so it cannot be recovered later, only revoked and replaced.
          </p>
          <Block>{`export TOKEN=osk_...\ncurl -H "x-access-token: $TOKEN" "${baseUrl}/api/v1/events"`}</Block>
        </section>

        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">Shape of a response</h2>
          <p className="mt-1 text-base leading-relaxed text-slate-900">
            Collections share one envelope. Single records come back as{" "}
            <code className="font-mono text-[15px]">{`{ "data": { ... } }`}</code>.
          </p>
          <Block>{`{
    "data": [ ... ],
    "page": 1,
    "pageSize": 25,
    "total": 42,
    "totalPages": 2
  }`}</Block>
          <p className="mt-2 text-base leading-relaxed text-slate-900">
            Paginate with <code className="font-mono text-[15px]">page</code> and{" "}
            <code className="font-mono text-[15px]">pageSize</code>, as query parameters or in a POST body. pageSize is
            capped at 100.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">Errors</h2>
          <p className="mt-1 text-base leading-relaxed text-slate-900">
            Errors are JSON with a stable code, never an HTML page.
          </p>
          <Block>{`{ "error": { "code": "invalid_token", "message": "That access token is not valid." } }`}</Block>
          <p className="mt-2 text-base leading-relaxed text-slate-900">
            401 missing or invalid token, 404 unknown event or record, 405 wrong method, 422 the body was understood but
            rejected, 400 the body was not valid JSON.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-base font-semibold text-slate-900">Endpoints</h2>
          <ul className="mt-4 space-y-6">
            {ENDPOINTS.map((endpoint, index) => (
              <li key={index} className="border-t border-slate-200 pt-4">
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-500">{endpoint.method}</span>
                  <code className="font-mono text-[15px] text-slate-900">{endpoint.path}</code>
                </p>
                <p className="mt-1 text-base leading-relaxed text-slate-500">{endpoint.description}</p>
                <Block>{endpoint.example(baseUrl)}</Block>
              </li>
            ))}
          </ul>
        </section>

        <nav className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-6 text-base">
          <Link to="/" className="font-medium text-accent hover:underline">
            Back to the event
          </Link>
          <Link to="/admin" className="text-slate-500 hover:text-slate-900">
            Organizer dashboard
          </Link>
        </nav>
      </main>
    </>
  );
}
