import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, Link } from "react-router";

import type { Route } from "./+types/root";
// Self-hosted per DESIGN.md: no third-party font request on first paint.
import "@fontsource-variable/inter";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let details = "An unexpected error occurred. Try again.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Page not found";
      details = "That page does not exist. Check the address, or go back to the start.";
    } else if (error.status === 403) {
      title = "No access";
      details = typeof error.data === "string" && error.data ? error.data : "You do not have access to this area.";
    } else {
      title = `Error ${error.status}`;
      details = (typeof error.data === "string" && error.data) || error.statusText || details;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{details}</p>
      <Link
        to="/"
        className="mt-4 inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 hover:bg-slate-50"
      >
        Go to the start
      </Link>
      {stack ? (
        <pre className="mt-6 w-full overflow-x-auto rounded-md bg-slate-50 p-4 text-xs text-slate-500">
          <code>{stack}</code>
        </pre>
      ) : null}
    </main>
  );
}
