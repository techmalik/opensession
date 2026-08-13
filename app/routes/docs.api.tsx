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

// The MCP tool list, kept next to the endpoint list it wraps. Every tool here is
// registered in app/lib/mcp-tools.server.ts; if one is added there, add its row.
const MCP_TOOLS: { name: string; description: string }[] = [
  { name: "list_events", description: "Events this token can reach. Start here: it returns the eventId every other tool needs." },
  { name: "search_sessions", description: "Search sessions by free text, status, track, format, room, and scheduled state." },
  { name: "get_session", description: "One session with speakers, status, track, format, room, and schedule." },
  { name: "update_session", description: "Change title, abstract, status, track, room, or start and end time." },
  { name: "list_speakers", description: "The speaker roster with confirmation status and task and file counts." },
  { name: "get_speaker", description: "One speaker with bio, sessions, and outstanding work." },
  { name: "list_submissions_by_status", description: "The submissions queue for one status, with review score averages." },
  { name: "accept_submission", description: "Set a submission to Accepted, or to the Accept Queue with queue: true." },
  { name: "decline_submission", description: "Set a submission to Declined, with optional feedback stored on the record." },
  { name: "get_agenda", description: "Rooms, days, scheduled and unscheduled sessions, and the double-booking conflicts." },
  { name: "list_open_tasks", description: "Speaker tasks and file requests still outstanding, marked todo or overdue." },
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
          credential. The same token also opens the{" "}
          <a href="#mcp" className="font-medium text-accent hover:underline">
            MCP server
          </a>{" "}
          at <code className="font-mono text-[15px]">/mcp</code>.
        </p>

        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">Getting a token</h2>
          <p className="mt-1 text-base leading-relaxed text-slate-900">
            Create one in an event's admin under Settings, API. The token is shown once, at creation. Only its hash is
            stored, so it cannot be recovered later, only revoked and replaced. A token reaches exactly the events the
            person who created it can open, on this API and over MCP alike.
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
                  <code className="break-all font-mono text-[15px] text-slate-900">{endpoint.path}</code>
                </p>
                <p className="mt-1 text-base leading-relaxed text-slate-500">{endpoint.description}</p>
                <Block>{endpoint.example(baseUrl)}</Block>
              </li>
            ))}
          </ul>
        </section>

        <section id="mcp" className="mt-10">
          <h2 className="text-base font-semibold text-slate-900">MCP server</h2>
          <p className="mt-1 text-base leading-relaxed text-slate-900">
            The same data over the Model Context Protocol, so an AI agent can run the conference program directly.
            Streamable HTTP transport at <code className="font-mono text-[15px]">{`${baseUrl}/mcp`}</code>, JSON-RPC 2.0
            over a single POST. Every tool wraps the endpoints above; nothing here can do more than a token can do.
          </p>
          <p className="mt-2 text-base leading-relaxed text-slate-900">
            Authenticate with the same token, as an{" "}
            <code className="font-mono text-[15px]">x-access-token</code> header or as{" "}
            <code className="font-mono text-[15px]">Authorization: Bearer</code>. A request with neither gets a JSON-RPC
            error saying where to make one. Tools reach only the events the organizer who created the token can open,
            which is narrower than the REST endpoints above.
          </p>
          <Block>{`curl -X POST -H "x-access-token: $TOKEN" -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \\
  "${baseUrl}/mcp"`}</Block>

          <h3 className="mt-6 text-[15px] font-semibold text-slate-900">Tools</h3>
          <ul className="mt-3 space-y-2">
            {MCP_TOOLS.map((tool) => (
              <li key={tool.name} className="border-t border-slate-200 pt-2">
                <code className="font-mono text-[15px] text-slate-900">{tool.name}</code>
                <p className="mt-0.5 text-base leading-relaxed text-slate-500">{tool.description}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-base leading-relaxed text-slate-900">
            Decision tools change status only. Sending acceptance and decline email stays the explicit step under
            Communications, Send decisions, which is where the templates and the calendar attachment live.
          </p>

          <h3 className="mt-6 text-[15px] font-semibold text-slate-900">Claude Code</h3>
          <p className="mt-1 text-base leading-relaxed text-slate-900">
            One command, or the JSON block if you would rather edit the file.
          </p>
          <Block>{`claude mcp add --transport http opensession ${baseUrl}/mcp \\
  --header "x-access-token: $TOKEN"`}</Block>
          <Block>{`{
  "mcpServers": {
    "opensession": {
      "type": "http",
      "url": "${baseUrl}/mcp",
      "headers": { "x-access-token": "osk_..." }
    }
  }
}`}</Block>

          <h3 className="mt-6 text-[15px] font-semibold text-slate-900">Codex</h3>
          <p className="mt-1 text-base leading-relaxed text-slate-900">
            Add this to <code className="font-mono text-[15px]">~/.codex/config.toml</code>.
          </p>
          <Block>{`[mcp_servers.opensession]
url = "${baseUrl}/mcp"
http_headers = { "x-access-token" = "osk_..." }`}</Block>
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
