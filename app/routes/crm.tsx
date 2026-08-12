// The CRM shell. This sits at organization level, above every event: the contact
// database, the sourcing pipeline, segments, and custom fields belong to the org,
// not to one conference.

import { Link, NavLink, Outlet, isRouteErrorResponse, useMatches, useRouteError } from "react-router";
import type { Route } from "./+types/crm";
import { requireOrganizer } from "../lib/session.server";
import { CRM_NAV } from "../lib/crm-view";
import { TopBar } from "../components/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  return { user };
}

/** The directory is the CRM's dense table and keeps the full width. Every other CRM
 *  page is a form, a dashboard, or a record, and reads at 960px. */
const WIDE_ROUTES = new Set(["routes/crm.contacts", "routes/crm.duplicates"]);

export default function CrmShell({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  const matches = useMatches();
  const wide = WIDE_ROUTES.has(matches[matches.length - 1]?.id ?? "");

  return (
    <div className="min-h-screen bg-slate-50">
      <TopBar
        section="Speaker CRM"
        userName={user.name}
        homeTo="/admin"
        actions={
          <Link to="/admin" className="text-[13px] text-slate-500 hover:text-slate-900">
            Events
          </Link>
        }
        nav={
          <nav aria-label="CRM sections" className="-mx-2 flex flex-wrap items-center gap-1 py-1.5">
            {CRM_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/crm"}
                className={({ isActive }) =>
                  `rounded-md px-2 py-1.5 text-[13px] font-medium ${
                    isActive ? "bg-slate-50 text-accent" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        }
      />

      <main className={`mx-auto w-full p-6 ${wide ? "max-w-[1200px]" : "max-w-[960px]"}`}>
        <Outlet />
      </main>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        {is404 ? "Not found" : "Something went wrong"}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {is404 ? "That record does not exist, or it was merged into another one." : "Try again, or go back to the directory."}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link to="/crm/contacts" className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50">
          Back to the directory
        </Link>
        <Link to="/admin" className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50">
          Events
        </Link>
        <Link to="/" className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50">
          Go to the start
        </Link>
      </div>
    </main>
  );
}
