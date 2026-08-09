import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "OpenSession" },
    { name: "description", content: "Speaker and content management for conferences." },
  ];
}

// Phase 1 replaces this with the real landing page: links to the organizer sign in,
// the public CFP form for the active event, the speaker portal, and the API docs.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold text-slate-900">OpenSession</h1>
      <p className="text-slate-600">
        Speaker and content management for conferences. Scaffold deployed; Phase 1 build
        replaces this page.
      </p>
    </main>
  );
}
