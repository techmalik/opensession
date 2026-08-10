import { Link, useLocation } from "react-router";
import type { Route } from "./+types/public.soon";

// Public destinations the landing page links to. Phase 2 replaces /cfp/:eventSlug with
// the real form, Phase 3 replaces /portal, Phase 5 replaces /api-docs. They resolve now
// so no public link is broken in the meantime.

export function meta(): Route.MetaDescriptors {
  return [{ title: "OpenSession" }];
}

const PAGES: Record<string, { title: string; note: string }> = {
  cfp: { title: "Call for papers", note: "The submission form for this event is not open here yet." },
  portal: { title: "Speaker portal", note: "Speakers will manage their sessions, tasks, and files here." },
  "api-docs": { title: "API", note: "The public API under /api/v1 is documented here." },
};

export default function PublicPlaceholder() {
  const location = useLocation();
  const segment = location.pathname.split("/").filter(Boolean)[0] ?? "";
  const page = PAGES[segment] ?? { title: "OpenSession", note: "This page is not available yet." };

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-16">
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{page.title}</h1>
      <p className="mt-2 text-base text-slate-500">{page.note}</p>
      <Link to="/" className="mt-6 inline-flex h-11 items-center text-base font-medium text-accent hover:underline">
        Back to the event
      </Link>
    </main>
  );
}
