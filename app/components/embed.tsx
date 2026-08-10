// Shared chrome for the five public widgets. Everything here is server-rendered
// HTML: search and filters are GET forms, expansions are <details>, so every widget
// works with no JavaScript, inside an iframe, logged out, at 375px.

import type { ReactNode } from "react";
import { WIDGETS, snippet, type PublicEvent, type PublicSession, type PublicSpeaker, type WidgetKind } from "../lib/embed-view";

export const embedInput =
  "h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-accent";

export const embedButton =
  "inline-flex h-11 items-center justify-center rounded-md bg-accent px-4 text-base font-medium text-white hover:bg-accent-hover";

export const embedButtonSecondary =
  "inline-flex h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-base font-medium text-slate-900 hover:bg-slate-50";

/** Event branding header, cross-links to the other widgets, and the attribution
 *  footer. `wide` gives the agenda grid room to breathe. */
export function EmbedShell({
  event,
  current,
  heading,
  children,
  wide = false,
}: {
  event: PublicEvent;
  current: WidgetKind;
  heading: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className={`mx-auto w-full ${wide ? "max-w-[1080px]" : "max-w-[720px]"} px-4 py-6 sm:px-6`}>
          <p className="text-[13px] font-medium tracking-wide text-slate-500">Public program</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{event.name}</h1>
          <p className="mt-1 text-base text-slate-500">
            {[event.dateRange, event.location].filter(Boolean).join(", ")}
          </p>
          <nav aria-label="Widgets" className="-mx-1 mt-4 flex flex-wrap gap-1">
            {WIDGETS.map((widget) => (
              <a
                key={widget.kind}
                href={`/embed/v1/${event.slug}/${widget.kind}`}
                aria-current={widget.kind === current ? "page" : undefined}
                className={`inline-flex h-11 items-center rounded-md px-3 text-base font-medium ${
                  widget.kind === current ? "bg-slate-50 text-accent" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {widget.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className={`mx-auto w-full ${wide ? "max-w-[1080px]" : "max-w-[720px]"} px-4 py-6 sm:px-6`}>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">{heading}</h2>
        {children}
      </main>

      <footer className="border-t border-slate-200">
        <div className={`mx-auto w-full ${wide ? "max-w-[1080px]" : "max-w-[720px]"} px-4 py-5 sm:px-6`}>
          <p className="text-[13px] text-slate-500">
            Powered by OpenSession.{" "}
            <a href={`/embed/v1/${event.slug}/calendar.ics`} className="font-medium text-accent hover:underline">
              Calendar feed
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export interface Facet {
  name: string;
  label: string;
  value: string;
  options: string[];
}

/** Keyword search plus an expandable facet panel. One GET form: the URL is the
 *  state, so a filtered view is shareable and cacheable. */
export function EmbedSearch({
  action,
  placeholder,
  q,
  facets = [],
  hidden = {},
  resultLabel,
}: {
  action: string;
  placeholder: string;
  q: string;
  facets?: Facet[];
  hidden?: Record<string, string>;
  resultLabel: string;
}) {
  const active = facets.filter((facet) => facet.value).length;
  return (
    <div className="mt-4">
      <form method="get" action={action} className="flex flex-wrap items-center gap-2">
        {Object.entries(hidden).map(([name, value]) =>
          value ? <input key={name} type="hidden" name={name} value={value} /> : null
        )}
        <label htmlFor="q" className="sr-only">
          {placeholder}
        </label>
        <input id="q" name="q" defaultValue={q} placeholder={placeholder} className={`${embedInput} min-w-0 flex-1`} />
        <button type="submit" className={embedButton}>
          Search
        </button>

        {facets.length > 0 ? (
          <details className="w-full" open={active > 0}>
            <summary className="inline-flex h-11 cursor-pointer list-none items-center rounded-md border border-slate-200 px-4 text-base font-medium text-slate-900 hover:bg-slate-50">
              Filters{active > 0 ? ` (${active})` : ""}
            </summary>
            <div className="mt-2 grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-3">
              {facets.map((facet) => (
                <div key={facet.name}>
                  <label htmlFor={facet.name} className="block text-[13px] font-medium text-slate-900">
                    {facet.label}
                  </label>
                  <select id={facet.name} name={facet.name} defaultValue={facet.value} className={`${embedInput} mt-1`}>
                    <option value="">All {facet.label.toLowerCase()}</option>
                    {facet.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="sm:col-span-3 flex flex-wrap items-center gap-2">
                <button type="submit" className={embedButton}>
                  Apply filters
                </button>
                <a href={action} className={embedButtonSecondary}>
                  Clear all
                </a>
              </div>
            </div>
          </details>
        ) : null}
      </form>
      <p className="mt-3 text-base text-slate-500">{resultLabel}</p>
    </div>
  );
}

/** Truncated text with an in-place Show more toggle. <details> keeps it working
 *  without a page reload and without any script. */
export function ShowMore({ text, chars }: { text: string; chars?: number }) {
  const { short, truncated } = snippet(text, chars);
  if (!text.trim()) return null;
  if (!truncated) return <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-slate-900">{text}</p>;
  return (
    <details className="group mt-2">
      <summary className="cursor-pointer list-none text-base leading-relaxed text-slate-900">
        <span className="group-open:hidden">{short} </span>
        <span className="font-medium text-accent group-open:hidden">Show more</span>
      </summary>
      <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-900">{text}</p>
      <span className="mt-1 inline-block text-base font-medium text-accent">Show less</span>
    </details>
  );
}

export function Avatar({ speaker, size = 48 }: { speaker: PublicSpeaker; size?: number }) {
  if (speaker.headshotUrl) {
    return (
      <img
        src={speaker.headshotUrl}
        alt={`Headshot of ${speaker.name}`}
        width={size}
        height={size}
        loading="lazy"
        className="shrink-0 rounded-full bg-slate-100 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-medium text-slate-500"
      style={{ width: size, height: size, fontSize: Math.round(size / 2.6) }}
    >
      {speaker.initials}
    </span>
  );
}

export function SpeakerLine({ speaker }: { speaker: PublicSpeaker }) {
  return (
    <li className="flex items-center gap-2.5 py-1">
      <Avatar speaker={speaker} size={32} />
      <span className="min-w-0 text-base text-slate-900">
        {speaker.name}
        {speaker.title || speaker.company ? (
          <span className="block text-[13px] text-slate-500">{[speaker.title, speaker.company].filter(Boolean).join(", ")}</span>
        ) : null}
      </span>
    </li>
  );
}

/** Track and format chips. Flat, bordered, no color fills beyond the track dot. */
export function SessionTags({ session }: { session: PublicSession }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-500">
      {session.formatName ? <span>Format: {session.formatName}</span> : null}
      {session.trackName ? (
        <span className="inline-flex items-center gap-1.5">
          {session.trackColor ? (
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: session.trackColor }} aria-hidden="true" />
          ) : null}
          Track: {session.trackName}
        </span>
      ) : null}
      {session.tags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </p>
  );
}

export function EmptyPublic({ message }: { message: string }) {
  return <p className="mt-6 text-base text-slate-500">{message}</p>;
}
