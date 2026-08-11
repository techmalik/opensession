// The full public overview for one event: name, dates, location, description, the
// call-for-papers card, and a links row to the event's public surfaces. Rendered
// standalone at /e/:eventSlug. Was previously the body of the homepage, back when
// the homepage could only ever be about one event.

import { Link } from "react-router";
import { daysUntil, formatDate, formatDateRange } from "../lib/format";

export interface PublicEventOverview {
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  location: string | null;
  timezone: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface PublicOpenForm {
  name: string;
  closesAt: Date | null;
}

const OVERVIEW_LINKS: { widget: string; label: string }[] = [
  { widget: "agenda", label: "Agenda" },
  { widget: "sessions", label: "Sessions" },
  { widget: "speakers", label: "Speakers" },
  { widget: "gallery", label: "Speaker gallery" },
];

export function EventOverview({
  event,
  openForm,
}: {
  event: PublicEventOverview;
  openForm: PublicOpenForm | null;
}) {
  const closesIn = daysUntil(openForm?.closesAt ?? null);
  // daysUntil returns 0 only for past dates (a close later today still counts as 1).
  const formClosed = openForm?.closesAt != null && closesIn === 0;

  return (
    <>
      <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-slate-900">{event.name}</h1>
      {event.tagline ? <p className="mt-2 text-base text-slate-500">{event.tagline}</p> : null}

      <dl className="mt-6 space-y-1 text-base text-slate-900">
        <div className="flex gap-2">
          <dt className="text-slate-500">Dates:</dt>
          <dd>{formatDateRange(event.startsAt, event.endsAt, event.timezone)}</dd>
        </div>
        {event.location ? (
          <div className="flex gap-2">
            <dt className="text-slate-500">Location:</dt>
            <dd>{event.location}</dd>
          </div>
        ) : null}
      </dl>

      {event.description ? <p className="mt-6 text-base leading-relaxed text-slate-900">{event.description}</p> : null}

      {openForm && !formClosed ? (
        <div className="mt-8 rounded-lg border border-slate-200 p-4">
          <h2 className="text-base font-semibold text-slate-900">{openForm.name}</h2>
          <p className="mt-1 text-base text-slate-500">
            {openForm.closesAt
              ? `Closes ${formatDate(openForm.closesAt, event.timezone)}, ${closesIn} days left`
              : "Open for submissions"}
          </p>
          <Link
            to={`/cfp/${event.slug}`}
            className="mt-3 inline-flex h-11 items-center justify-center rounded-md bg-accent px-4 text-base font-medium text-white hover:bg-accent-hover"
          >
            Submit a talk
          </Link>
        </div>
      ) : openForm && formClosed ? (
        <p className="mt-8 text-base text-slate-500">
          Form closed {formatDate(openForm.closesAt, event.timezone)}.
        </p>
      ) : (
        <p className="mt-8 text-base text-slate-500">Submissions are not open right now.</p>
      )}

      <nav aria-label="Public program" className="mt-8 border-t border-slate-200 pt-6">
        <h2 className="text-base font-semibold text-slate-900">Programme</h2>
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-base">
          {OVERVIEW_LINKS.map((link) => (
            <li key={link.widget}>
              <Link to={`/embed/v1/${event.slug}/${link.widget}`} className="font-medium text-accent hover:underline">
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <a href={`/embed/v1/${event.slug}/calendar.ics`} className="text-slate-500 hover:text-slate-900">
              Add to calendar
            </a>
          </li>
        </ul>
      </nav>
    </>
  );
}

/** Compact card for a link-through context (the homepage's featured event): name,
 *  dates, location, and the call-for-papers status, nothing else. */
export function eventCfpStatus(
  event: Pick<PublicEventOverview, "timezone">,
  openForm: PublicOpenForm | null
): string {
  const closesIn = daysUntil(openForm?.closesAt ?? null);
  const formClosed = openForm?.closesAt != null && closesIn === 0;
  if (!openForm) return "Submissions are not open right now.";
  if (formClosed) return `Form closed ${formatDate(openForm.closesAt, event.timezone)}.`;
  return openForm.closesAt
    ? `Open for submissions, closes ${formatDate(openForm.closesAt, event.timezone)}`
    : "Open for submissions";
}
