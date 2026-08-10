import { Link } from "react-router";
import type { Route } from "./+types/docs.api";

// Public, no-auth API reference at /docs/api. Phase 5 fills this in with the real
// endpoint reference (events list, session search, session CRUD, contacts, statuses,
// tracks/tags/formats/rooms) under /api/v1. Until then this page exists so no public
// link 404s and organizers know where tokens come from.

export function meta(): Route.MetaDescriptors {
  return [
    { title: "API | OpenSession" },
    { name: "description", content: "Reference for the OpenSession public API." },
  ];
}

const PLANNED_ENDPOINTS: { method: string; path: string; description: string }[] = [
  { method: "GET", path: "/api/v1/events", description: "List events" },
  { method: "GET", path: "/api/v1/event/:id", description: "Get one event" },
  { method: "POST", path: "/api/v1/event/:id/sessions", description: "Search sessions" },
  { method: "GET", path: "/api/v1/event/:id/sessions/:sessionId", description: "Get one session" },
  { method: "POST", path: "/api/v1/event/:id/sessions", description: "Create a session" },
  { method: "PATCH", path: "/api/v1/event/:id/sessions/:sessionId", description: "Update a session" },
  { method: "DELETE", path: "/api/v1/event/:id/sessions/:sessionId", description: "Delete a session" },
  { method: "GET", path: "/api/v1/event/:id/contacts", description: "List contacts" },
  { method: "GET", path: "/api/v1/event/:id/statuses", description: "List statuses" },
  { method: "GET", path: "/api/v1/event/:id/tracks", description: "List tracks" },
  { method: "GET", path: "/api/v1/event/:id/formats", description: "List formats" },
  { method: "GET", path: "/api/v1/event/:id/rooms", description: "List rooms" },
];

export default function ApiDocs() {
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-16">
      <p className="text-[13px] font-medium tracking-wide text-slate-500">OpenSession</p>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">API</h1>
      <p className="mt-2 text-base text-slate-500">
        A public API under <code className="font-mono text-[15px]">/api/v1</code>, authenticated with an{" "}
        <code className="font-mono text-[15px]">x-access-token</code> header. Full request and response reference is
        coming; this page lists the planned surface.
      </p>

      <p className="mt-6 text-base text-slate-900">
        Tokens are created in <span className="font-medium">Settings, API</span> inside an event's admin area.
      </p>

      <section className="mt-8 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
              <th scope="col" className="px-4 py-2 font-medium">Method</th>
              <th scope="col" className="px-4 py-2 font-medium">Path</th>
              <th scope="col" className="px-4 py-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {PLANNED_ENDPOINTS.map((endpoint, index) => (
              <tr key={index} className="border-b border-slate-100 last:border-0">
                <td className="h-10 px-4 font-mono text-xs text-slate-500">{endpoint.method}</td>
                <td className="px-4 font-mono text-xs text-slate-900">{endpoint.path}</td>
                <td className="px-4 text-slate-500">{endpoint.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="mt-4 text-sm text-slate-500">Paginated with page and pageSize. Full reference is not published yet.</p>

      <nav className="mt-10 border-t border-slate-200 pt-6">
        <Link to="/" className="text-base font-medium text-accent hover:underline">
          Back to the event
        </Link>
      </nav>
    </main>
  );
}
