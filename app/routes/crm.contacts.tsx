// The contact directory: search, attribute filters, saved segments, bulk select,
// and the actions that make the database worth keeping. Push contacts into an
// event, email a selection, save the current view as a segment, merge duplicates.

import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/crm.contacts";
import { requireOrganizer } from "../lib/session.server";
import {
  addContactsToEvent,
  createSegment,
  crmViewer,
  filterOptions,
  listContacts,
  listEventsForPicker,
  listSegments,
  type CrmFilters,
} from "../lib/crm.server";
import { CRM_STAGES } from "../lib/crm-view";
import { Card, EmptyState, ErrorNotice, Notice, PageHeader, buttonPrimary, buttonSecondary, inputSized, selectSized } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Directory" }];
}

function readFilters(url: URL): CrmFilters {
  return {
    q: url.searchParams.get("q") ?? "",
    company: url.searchParams.get("company") ?? "",
    title: url.searchParams.get("title") ?? "",
    tag: url.searchParams.get("tag") ?? "",
    stage: url.searchParams.get("stage") ?? "",
    hasEvent: url.searchParams.get("hasEvent") ?? "",
    segmentId: Number(url.searchParams.get("segment") ?? 0) || undefined,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  const viewer = await crmViewer(user);
  const url = new URL(request.url);
  const filters = readFilters(url);

  const rows = await listContacts(viewer, filters);
  const all = await listContacts(viewer);

  return {
    rows,
    total: all.length,
    filters,
    options: await filterOptions(viewer),
    segments: await listSegments(viewer),
    events: await listEventsForPicker(viewer),
    stages: CRM_STAGES,
    duplicateCount: all.filter((row) => row.duplicateOf != null).length,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const viewer = await crmViewer(user);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const ids = form.getAll("ids").map(Number).filter(Number.isInteger);

  if (intent === "save-segment") {
    const name = String(form.get("segmentName") ?? "").trim();
    if (!name) return { error: "Name the segment before saving it.", notice: null };
    const kind = String(form.get("segmentKind") ?? "dynamic") === "curated" ? "curated" : "dynamic";
    if (kind === "curated" && ids.length === 0) {
      return { error: "Select the contacts to put in a curated segment.", notice: null };
    }
    const filters: CrmFilters = {
      q: String(form.get("f_q") ?? ""),
      company: String(form.get("f_company") ?? ""),
      title: String(form.get("f_title") ?? ""),
      tag: String(form.get("f_tag") ?? ""),
      stage: String(form.get("f_stage") ?? ""),
      hasEvent: String(form.get("f_hasEvent") ?? ""),
    };
    const id = await createSegment({ name, kind, filters, memberIds: ids, userId: user.id });
    return {
      error: null,
      notice: `Saved "${name}" as a ${kind} segment.`,
      segmentId: id,
    };
  }

  if (ids.length === 0) return { error: "Select at least one contact.", notice: null };

  if (intent === "add-to-event") {
    const eventId = Number(form.get("eventId") ?? 0);
    if (!eventId) return { error: "Choose an event.", notice: null };
    const added = await addContactsToEvent(viewer, eventId, ids);
    const events = await listEventsForPicker(viewer);
    const name = events.find((row) => row.id === eventId)?.name ?? "the event";
    return {
      error: null,
      notice:
        added === 0
          ? `Everyone selected was already on ${name}.`
          : `Added ${added} ${added === 1 ? "contact" : "contacts"} to ${name} with their profile intact.`,
    };
  }

  return { error: null, notice: null };
}

export default function CrmContacts({ loaderData, actionData }: Route.ComponentProps) {
  const { rows, total, filters, options, segments, events, stages, duplicateCount } = loaderData;
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected((prev) => (prev.size === rows.length ? new Set<number>() : new Set(rows.map((r) => r.id))));

  const activeFilters = [
    filters.company ? `Company: ${filters.company}` : "",
    filters.title ? `Title: ${filters.title}` : "",
    filters.tag ? `Tag: ${filters.tag}` : "",
    filters.stage ? `Stage: ${filters.stage}` : "",
    filters.hasEvent === "yes" ? "On an event" : filters.hasEvent === "no" ? "Not on any event" : "",
    filters.segmentId ? `Segment: ${segments.find((s) => s.id === filters.segmentId)?.name ?? filters.segmentId}` : "",
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Directory"
        description={`${rows.length} of ${total} contacts across every event.`}
        actions={
          <>
            <Link to="/crm/import" className={buttonSecondary}>
              Import CSV
            </Link>
            <Link to="/crm/contacts/new" className={buttonPrimary}>
              Add contact
            </Link>
          </>
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}
      {duplicateCount > 0 ? (
        <Notice>
          {duplicateCount} {duplicateCount === 1 ? "contact shares a name with another" : "contacts share a name with another"}.{" "}
          <Link to="/crm/duplicates" className="font-medium text-accent hover:underline">
            Review duplicates
          </Link>
        </Notice>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Form method="get" className="flex flex-1 flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Search name, email, or company"
              aria-label="Search contacts"
              className={`${inputSized} w-60 flex-none`}
            />
            <select name="company" defaultValue={filters.company} aria-label="Filter by company" className={`${selectSized} w-44 flex-none`}>
              <option value="">Any company</option>
              {options.companies.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select name="title" defaultValue={filters.title} aria-label="Filter by job title" className={`${selectSized} w-44 flex-none`}>
              <option value="">Any job title</option>
              {options.titles.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select name="tag" defaultValue={filters.tag} aria-label="Filter by tag" className={`${selectSized} w-36 flex-none`}>
              <option value="">Any tag</option>
              {options.tags.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select name="stage" defaultValue={filters.stage} aria-label="Filter by pipeline stage" className={`${selectSized} w-40 flex-none`}>
              <option value="">Any stage</option>
              {stages.map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
            </select>
            <select name="hasEvent" defaultValue={filters.hasEvent} aria-label="Filter by event history" className={`${selectSized} w-44 flex-none`}>
              <option value="">Any event history</option>
              <option value="yes">On at least one event</option>
              <option value="no">Not on any event</option>
            </select>
            <button type="submit" className={buttonSecondary}>
              Apply filters
            </button>
            {activeFilters.length > 0 ? (
              <Link to="/crm/contacts" className="text-[13px] font-medium text-slate-500 hover:text-slate-900">
                Clear all
              </Link>
            ) : null}
          </Form>
          <a href={`/crm/contacts/export.csv?${searchParams.toString()}`} className={buttonSecondary}>
            Export CSV
          </a>
        </div>

        {activeFilters.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2">
            {activeFilters.map((label) => (
              <span key={label} className="inline-flex h-6 items-center rounded-full border border-slate-200 bg-white px-2 text-xs text-slate-900">
                {label}
              </span>
            ))}
          </div>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            message={total === 0 ? "No contacts yet. Import a CSV or add one by hand." : "No contacts match these filters."}
            action={
              total === 0 ? (
                <Link to="/crm/import" className={buttonSecondary}>
                  Import CSV
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Form method="post">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.size === rows.length && rows.length > 0}
                        onChange={toggleAll}
                        aria-label="Select all"
                        className="accent-accent"
                      />
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">Name</th>
                    <th scope="col" className="px-3 py-2 font-medium">Email</th>
                    <th scope="col" className="px-3 py-2 font-medium">Job title</th>
                    <th scope="col" className="px-3 py-2 font-medium">Company</th>
                    <th scope="col" className="px-3 py-2 font-medium">Tags</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Events</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-3">
                        <input
                          type="checkbox"
                          name="ids"
                          value={row.id}
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Select ${row.name}`}
                          className="accent-accent"
                        />
                      </td>
                      <td className="h-10 max-w-[220px] px-3">
                        <Link to={`/crm/contacts/${row.id}`} className="block truncate font-medium text-slate-900 hover:text-accent">
                          {row.name}
                        </Link>
                        {row.duplicateOf ? (
                          <Link to="/crm/duplicates" className="text-xs font-medium text-amber-600 hover:underline">
                            Possible duplicate
                          </Link>
                        ) : null}
                      </td>
                      <td className="max-w-[220px] truncate px-3 text-slate-500">{row.email}</td>
                      <td className="max-w-[180px] truncate px-3 text-slate-900">{row.title ?? ""}</td>
                      <td className="max-w-[180px] truncate px-3 text-slate-900">{row.company ?? ""}</td>
                      <td className="max-w-[160px] truncate px-3 text-slate-500">{row.tags.join(", ")}</td>
                      <td className="px-3 text-right tabular-nums text-slate-900">{row.eventCount}</td>
                      <td className="px-3 text-right tabular-nums text-slate-500">{row.sessionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2.5">
                <p className="text-[13px] text-slate-500">{selected.size} selected</p>

                <select name="eventId" aria-label="Event to add to" className={`${selectSized} w-52 flex-none`}>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
                <button type="submit" name="intent" value="add-to-event" className={buttonSecondary}>
                  Add to event
                </button>

                <span className="mx-1 text-slate-300">|</span>
                <button
                  type="submit"
                  formAction={`/crm/email?${searchParams.toString()}`}
                  formMethod="get"
                  className={buttonSecondary}
                >
                  Send email
                </button>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2.5">
              <input type="hidden" name="f_q" value={filters.q ?? ""} />
              <input type="hidden" name="f_company" value={filters.company ?? ""} />
              <input type="hidden" name="f_title" value={filters.title ?? ""} />
              <input type="hidden" name="f_tag" value={filters.tag ?? ""} />
              <input type="hidden" name="f_stage" value={filters.stage ?? ""} />
              <input type="hidden" name="f_hasEvent" value={filters.hasEvent ?? ""} />
              <p className="text-[13px] text-slate-500">Save this view:</p>
              <input name="segmentName" placeholder="Segment name" aria-label="Segment name" className={`${inputSized} w-48 flex-none`} />
              <select name="segmentKind" defaultValue="dynamic" aria-label="Segment type" className={`${selectSized} w-56 flex-none`}>
                <option value="dynamic">Dynamic, follows the filters</option>
                <option value="curated">Curated, the selected contacts</option>
              </select>
              <button type="submit" name="intent" value="save-segment" className={buttonSecondary}>
                Save segment
              </button>
            </div>
          </Form>
        )}
      </Card>

      {segments.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-slate-500">Segments:</span>
          {segments.map((segment) => (
            <Link
              key={segment.id}
              to={`/crm/contacts?segment=${segment.id}`}
              className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium ${
                filters.segmentId === segment.id ? "border-accent text-accent" : "border-slate-200 text-slate-500 hover:text-slate-900"
              }`}
            >
              {segment.name} ({segment.count})
            </Link>
          ))}
          <Link to="/crm/segments" className="ml-1 text-[13px] font-medium text-accent hover:underline">
            Manage
          </Link>
        </div>
      ) : null}
    </>
  );
}
