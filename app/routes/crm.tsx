// The CRM shell. This sits at organization level, above every event: the contact
// database, the sourcing pipeline, segments, and custom fields belong to the org,
// not to one conference.

import { Form, Link, NavLink, Outlet, isRouteErrorResponse, useRouteError } from "react-router";
import type { Route } from "./+types/crm";
import { requireOrganizer } from "../lib/session.server";
import { CRM_NAV } from "../lib/crm-view";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  return { user };
}

export default function CrmShell({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link to="/crm" className="text-sm font-semibold text-slate-900">
            Speaker CRM
          </Link>
          <nav aria-label="CRM sections" className="flex flex-1 flex-wrap items-center gap-1">
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
          <div className="flex items-center gap-4">
            <Link to="/admin" className="text-[13px] text-slate-500 hover:text-slate-900">
              Events
            </Link>
            <span className="text-[13px] text-slate-500">{user.name}</span>
            <Form method="post" action="/logout">
              <button type="submit" className="text-[13px] font-medium text-slate-500 hover:text-slate-900">
                Sign out
              </button>
            </Form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] p-6">
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
      <Link
        to="/crm/contacts"
        className="mt-4 inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50"
      >
        Back to the directory
      </Link>
    </main>
  );
}
