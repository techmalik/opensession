// Shared primitives so every screen inherits DESIGN.md instead of re-deciding it.
// One primary button per view; everything else is secondary or ghost.

import { useEffect, useState, type ReactNode } from "react";
import { Form, Link, useNavigation } from "react-router";
import { PUBLIC_STATE_LABEL, type PublicState } from "../lib/labels";
import { homeLabelFor, landingFor } from "../lib/roles";
import { LogoMark } from "./brand";

/** The one loading state in the product. DESIGN.md: no skeleton shimmer, and
 *  anything that resolves under 200ms just renders, so the bar is delayed rather
 *  than shown on every click. */
export function RouteProgress() {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!busy) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, [busy]);

  if (!visible) return null;
  return <div role="status" aria-label="Loading" className="fixed inset-x-0 top-0 z-50 h-0.5 bg-accent" />;
}

export const buttonPrimary =
  "inline-flex h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50";

export const buttonSecondary =
  "inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-50";

export const buttonGhost =
  "inline-flex h-9 items-center justify-center rounded-md px-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900";

export const buttonDanger =
  "inline-flex h-9 items-center justify-center rounded-md border border-rose-200 bg-white px-3 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50";

const controlBase =
  "h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent";

/** Full-width control. The default, because forms are single column. */
export const inputClass = `${controlBase} w-full`;

export const selectClass = inputClass;

/** Same control with no width of its own, for toolbars and inline fields that set
 *  their own. Tailwind emits w-full after the fixed widths, so `${inputClass} w-44`
 *  lost every time and filter toolbars stretched to the full table width. */
export const inputSized = controlBase;

export const selectSized = controlBase;

export const textareaClass =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-accent";

/** Labels above inputs, 13px help below, required marked with a plain asterisk. */
export function Field({
  label,
  name,
  help,
  error,
  required,
  children,
}: {
  label: string;
  name: string;
  help?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-slate-900">
        {label}
        {required ? <span className="ml-0.5 text-slate-500">*</span> : null}
      </label>
      {children}
      {help ? <p className="text-[13px] leading-snug text-slate-500">{help}</p> : null}
      {error ? <p className="text-[13px] leading-snug text-rose-600">{error}</p> : null}
    </div>
  );
}

/** Summary at the top of a form on submit, alongside the inline field errors. */
export function ErrorSummary({ errors }: { errors: Record<string, string> }) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return null;
  return (
    <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2">
      <p className="text-sm font-medium text-rose-600">
        {entries.length === 1 ? "There is 1 problem with this form." : `There are ${entries.length} problems with this form.`}
      </p>
      <ul className="mt-1 list-inside list-disc text-[13px] text-rose-600">
        {entries.map(([field, message]) => (
          <li key={field}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

/** One sentence plus one action. No illustrations. */
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-10">
      <p className="text-sm text-slate-500">{message}</p>
      {action}
    </div>
  );
}

const STATUS_DOT: Record<string, string> = {
  pending: "bg-slate-400",
  accept_queue: "bg-sky-600",
  accepted: "bg-accent",
  decline_queue: "bg-amber-600",
  declined: "bg-rose-600",
};

/** Small dot plus label. Never a full-width colored row. */
export function StatusBadge({ statusKey, label }: { statusKey: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-900">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[statusKey] ?? "bg-slate-400"}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
      {children}
    </span>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{children}</div>;
}

export function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
      {children}
    </div>
  );
}

/** Sub-navigation inside one admin area. Plain links, current one in the accent. */
export function SubNav({ items, current }: { items: { to: string; label: string }[]; current: string }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={`rounded-md px-2 py-1 text-[13px] font-medium ${
            item.to === current ? "bg-slate-50 text-accent" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

const PORTAL_TABS: { to: string; label: string }[] = [
  { to: "/portal", label: "Overview" },
  { to: "/portal/schedule", label: "My schedule" },
  { to: "/portal/tasks", label: "My tasks" },
  { to: "/portal/files", label: "My files" },
  { to: "/portal/profile", label: "My profile" },
];

/** Speaker portal navigation. Horizontal scroll rather than wrap at 375px, so the
 *  tab row never pushes the page content below the fold on a phone. */
export function PortalNav({ current }: { current: string }) {
  return (
    <nav aria-label="Portal sections" className="-mx-6 mb-5 overflow-x-auto px-6">
      <ul className="flex min-w-max items-center gap-1 border-b border-slate-200 pb-2">
        {PORTAL_TABS.map((tab) => (
          <li key={tab.to}>
            <Link
              to={tab.to}
              aria-current={tab.to === current ? "page" : undefined}
              className={`inline-flex h-11 items-center rounded-md px-3 text-sm font-medium sm:h-9 ${
                tab.to === current ? "bg-slate-50 text-accent" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Task and deliverable states, distinct from submission statuses. */
export function TaskBadge({ status }: { status: "done" | "todo" | "overdue" }) {
  const dot = status === "done" ? "bg-accent" : status === "overdue" ? "bg-rose-600" : "bg-slate-400";
  const label = status === "done" ? "Complete" : status === "overdue" ? "Overdue" : "Incomplete";
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-900">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ApprovalBadge({ approval }: { approval: "pending" | "approved" | "denied" }) {
  const dot = approval === "approved" ? "bg-accent" : approval === "denied" ? "bg-rose-600" : "bg-slate-400";
  const label = approval === "approved" ? "Approved" : approval === "denied" ? "Denied" : "Pending review";
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-900">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Whether a session is allowed on the public agenda, widgets, and calendar feed. */
export function PublicStateBadge({ state }: { state: PublicState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-900">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${state === "held" ? "bg-amber-600" : "bg-accent"}`}
        aria-hidden="true"
      />
      {PUBLIC_STATE_LABEL[state]}
    </span>
  );
}

/** Top bar for signed-in non-admin surfaces (speaker portal, reviewer dashboard).
 *  Deliberately free of any organizer navigation. */
export function AppBar({ title, userName, homeTo }: { title: string; userName: string; homeTo: string }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 w-full max-w-[960px] items-center justify-between px-6">
        <Link to={homeTo} className="text-base font-semibold tracking-tight text-slate-900">
          {title}
        </Link>
        <div className="flex items-center gap-4">
          <span className="hidden text-[13px] text-slate-500 sm:inline">{userName}</span>
          <Form method="post" action="/logout">
            <button type="submit" className="text-[13px] font-medium text-slate-500 hover:text-slate-900">
              Sign out
            </button>
          </Form>
        </div>
      </div>
    </header>
  );
}

/** Slim top bar for signed-in surfaces that have no sidebar of their own: the events
 *  list, event creation, and the CRM. The wordmark always goes to the role home, so
 *  no signed-in page is a dead end. `nav` renders as a second row inside the same
 *  header, which keeps section links off the identity row at 768px. */
export function TopBar({
  section,
  userName,
  homeTo,
  actions,
  nav,
}: {
  section: string;
  userName: string;
  homeTo: string;
  actions?: ReactNode;
  nav?: ReactNode;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
        <Link to={homeTo} className="inline-flex shrink-0 items-center gap-2">
          <LogoMark size={20} />
          <span className="text-sm font-semibold tracking-tight text-slate-900">OpenSession</span>
        </Link>
        <span className="shrink-0 text-slate-300" aria-hidden="true">
          /
        </span>
        <span className="truncate text-[13px] text-slate-900">{section}</span>
        <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-4">
          {actions}
          <span className="hidden text-[13px] text-slate-500 sm:inline">{userName}</span>
          <Form method="post" action="/logout">
            <button type="submit" className="text-[13px] font-medium text-slate-500 hover:text-slate-900">
              Sign out
            </button>
          </Form>
        </div>
      </div>
      {nav ? <div className="-mt-px border-t border-slate-100 px-4 sm:px-6">{nav}</div> : null}
    </header>
  );
}

/** DESIGN.md: every detail view has a breadcrumb back to its table. One line of
 *  small slate links, the last item being the current page. */
export function Breadcrumbs({ items }: { items: { to?: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-slate-500">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-x-1.5">
            {index > 0 ? (
              <span className="text-slate-300" aria-hidden="true">
                /
              </span>
            ) : null}
            {item.to ? (
              <Link to={item.to} className="hover:text-slate-900">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="truncate text-slate-900">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Chrome for the public pages: CFP, the submission form, the public agenda, the
 *  event page, and the API docs. Never used inside a widget, which must stay free of
 *  product chrome. `role` comes from the signed cookie, so the right-hand link is a
 *  way back into the app rather than a second sign-in. */
export function PublicHeader({
  eventName,
  eventSlug,
  role,
  width = "max-w-[720px]",
}: {
  eventName?: string | null;
  eventSlug?: string | null;
  role?: string | null;
  width?: string;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className={`mx-auto flex h-14 w-full ${width} items-center gap-2 px-4 sm:px-6`}>
        <Link to="/" className="inline-flex h-11 shrink-0 items-center gap-2">
          <LogoMark size={20} />
          <span className="text-sm font-semibold tracking-tight text-slate-900">OpenSession</span>
        </Link>
        {eventName ? (
          <>
            <span className="shrink-0 text-slate-300" aria-hidden="true">
              /
            </span>
            {eventSlug ? (
              <Link to={`/e/${eventSlug}`} className="inline-flex h-11 min-w-0 items-center text-sm text-slate-500 hover:text-slate-900">
                <span className="truncate">{eventName}</span>
              </Link>
            ) : (
              <span className="truncate text-sm text-slate-500">{eventName}</span>
            )}
          </>
        ) : null}
        <div className="ml-auto shrink-0">
          <Link
            to={role ? landingFor(role) : "/login"}
            className="inline-flex h-11 items-center text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            {role ? homeLabelFor(role) : "Sign in"}
          </Link>
        </div>
      </div>
    </header>
  );
}
