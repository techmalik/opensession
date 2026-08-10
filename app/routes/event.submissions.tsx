// The organizer submissions table. Dense, filterable, bulk-actionable. Accepted
// submissions stay in this table (with is_abstract flipped off) so the pipeline is
// visible end to end.

import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/event.submissions";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { querySubmissions } from "../lib/submissions.server";
import { formatDate, formatScore } from "../lib/format";
import { events, formats, sessions, statuses, tracks } from "../../database/schema";
import {
  Card,
  EmptyState,
  PageHeader,
  PublicStateBadge,
  StatusBadge,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Submissions" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db
    .select({ name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const filters = {
    q: url.searchParams.get("q") ?? "",
    statusKey: url.searchParams.get("status") ?? "",
    trackId: Number(url.searchParams.get("track") ?? 0) || undefined,
    formatId: Number(url.searchParams.get("format") ?? 0) || undefined,
    publicState: url.searchParams.get("public") ?? "",
    sort: (url.searchParams.get("sort") === "score" ? "score" : "submitted") as "score" | "submitted",
    dir: (url.searchParams.get("dir") === "asc" ? "asc" : "desc") as "asc" | "desc",
  };

  const rows = await querySubmissions(eventId, filters);

  const statusRows = await db
    .select({ id: statuses.id, key: statuses.key, label: statuses.label, sort: statuses.sort })
    .from(statuses)
    .where(eq(statuses.eventId, eventId))
    .orderBy(asc(statuses.sort))
    .all();
  const trackRows = await db
    .select({ id: tracks.id, name: tracks.name })
    .from(tracks)
    .where(eq(tracks.eventId, eventId))
    .orderBy(asc(tracks.sort))
    .all();
  const formatRows = await db
    .select({ id: formats.id, name: formats.name })
    .from(formats)
    .where(eq(formats.eventId, eventId))
    .orderBy(asc(formats.sort))
    .all();

  // Chip counts ignore the status filter but respect nothing else: they are the
  // event-wide pipeline at a glance.
  const allRows = await querySubmissions(eventId, {});
  const countByStatus = new Map<string, number>();
  for (const row of allRows) {
    const key = row.statusKey ?? "pending";
    countByStatus.set(key, (countByStatus.get(key) ?? 0) + 1);
  }

  return {
    event,
    rows,
    filters,
    statuses: statusRows,
    tracks: trackRows,
    formats: formatRows,
    total: allRows.length,
    countByStatus: Object.fromEntries(countByStatus),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const ids = form.getAll("ids").map(Number).filter(Number.isInteger);
  if (ids.length === 0) return { error: "Select at least one submission." };

  // CNT-12 bulk gate: hold or publish the selection without touching its status.
  if (intent === "bulk-hold" || intent === "bulk-publish") {
    const held = intent === "bulk-hold";
    const owned = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.eventId, eventId), inArray(sessions.id, ids)))
      .all();
    for (const row of owned) {
      await db
        .update(sessions)
        .set({ publicState: held ? "held" : "published", updatedAt: new Date() })
        .where(eq(sessions.id, row.id));
    }
    return {
      error: null,
      notice: `${held ? "Held" : "Published"} ${owned.length} ${owned.length === 1 ? "session" : "sessions"}.`,
    };
  }

  let statusId: number | null = null;
  if (intent === "bulk-accept-queue" || intent === "bulk-decline-queue") {
    const key = intent === "bulk-accept-queue" ? "accept_queue" : "decline_queue";
    const status = await db
      .select({ id: statuses.id, key: statuses.key })
      .from(statuses)
      .where(and(eq(statuses.eventId, eventId), eq(statuses.key, key)))
      .get();
    if (!status) return { error: "That status does not exist." };
    statusId = status.id;
  } else if (intent === "bulk-set-status") {
    statusId = Number(form.get("statusId") ?? 0) || null;
    if (!statusId) return { error: "Choose a status to apply." };
  } else {
    return { error: null };
  }

  const status = await db
    .select({ id: statuses.id, key: statuses.key, label: statuses.label })
    .from(statuses)
    .where(and(eq(statuses.eventId, eventId), eq(statuses.id, statusId)))
    .get();
  if (!status) return { error: "That status does not exist." };

  // Guard: only this event's sessions.
  const owned = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.eventId, eventId), inArray(sessions.id, ids)))
    .all();

  const now = new Date();
  for (const row of owned) {
    await db
      .update(sessions)
      .set({
        statusId: status.id,
        // Accepted submissions become sessions; anything else is (still) an abstract.
        isAbstract: status.key !== "accepted",
        updatedAt: now,
      })
      .where(eq(sessions.id, row.id));
  }

  return { error: null, notice: `Moved ${owned.length} ${owned.length === 1 ? "submission" : "submissions"} to ${status.label}.` };
}

export default function Submissions({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, rows, filters, statuses: statusRows, tracks: trackRows, formats: formatRows, total, countByStatus } = loaderData;
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => (prev.size === rows.length ? new Set<number>() : new Set(rows.map((r) => r.id))));
  };

  const chipParams = (statusKey: string) => {
    const p = new URLSearchParams(searchParams);
    if (statusKey) p.set("status", statusKey);
    else p.delete("status");
    return `?${p.toString()}`;
  };

  const sortParams = (sort: "score" | "submitted") => {
    const p = new URLSearchParams(searchParams);
    const dir = filters.sort === sort && filters.dir === "desc" ? "asc" : "desc";
    p.set("sort", sort);
    p.set("dir", dir);
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Submissions"
        description={`${total} ${total === 1 ? "submission" : "submissions"} for ${event.name}`}
        actions={
          <>
            <Link to={`/admin/${params.eventId}/submissions/send-decisions`} className={buttonSecondary}>
              Send decision emails
            </Link>
            <Link to={`/admin/${params.eventId}/submissions/new`} className={buttonPrimary}>
              Add submission
            </Link>
          </>
        }
      />

      {actionData?.error ? (
        <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {actionData.error}
        </div>
      ) : null}
      {actionData && "notice" in actionData && actionData.notice ? (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{actionData.notice}</div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Link
          to={chipParams("")}
          className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium ${
            !filters.statusKey ? "border-accent text-accent" : "border-slate-200 text-slate-500 hover:text-slate-900"
          }`}
        >
          All ({total})
        </Link>
        {statusRows.map((status) => (
          <Link
            key={status.id}
            to={chipParams(status.key)}
            className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium ${
              filters.statusKey === status.key ? "border-accent text-accent" : "border-slate-200 text-slate-500 hover:text-slate-900"
            }`}
          >
            {status.label} ({countByStatus[status.key] ?? 0})
          </Link>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Form method="get" className="flex flex-1 flex-wrap items-center gap-2">
            {filters.statusKey ? <input type="hidden" name="status" value={filters.statusKey} /> : null}
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Search title, ID, or speaker"
              aria-label="Search submissions"
              className={`${inputClass} w-64 flex-none`}
            />
            <select name="track" defaultValue={filters.trackId ?? ""} aria-label="Filter by track" className={`${selectClass} w-44 flex-none`}>
              <option value="">All tracks</option>
              {trackRows.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
            <select name="format" defaultValue={filters.formatId ?? ""} aria-label="Filter by format" className={`${selectClass} w-44 flex-none`}>
              <option value="">All formats</option>
              {formatRows.map((format) => (
                <option key={format.id} value={format.id}>
                  {format.name}
                </option>
              ))}
            </select>
            <select
              name="public"
              defaultValue={filters.publicState}
              aria-label="Filter by public visibility"
              className={`${selectClass} w-44 flex-none`}
            >
              <option value="">Any visibility</option>
              <option value="published">Published</option>
              <option value="held">Held from public</option>
            </select>
            <button type="submit" className={buttonSecondary}>
              Filter
            </button>
          </Form>
          <a href={`/admin/${params.eventId}/submissions/export.csv?${searchParams.toString()}`} className={buttonSecondary}>
            Export CSV
          </a>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            message={total === 0 ? "No submissions yet. Publish a form to start collecting them." : "No submissions match this filter."}
            action={
              total === 0 ? (
                <Link to={`/admin/${params.eventId}/forms`} className={buttonSecondary}>
                  Go to Forms
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Form method="post">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[13px]">
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
                    <th scope="col" className="px-3 py-2 font-medium">ID</th>
                    <th scope="col" className="px-3 py-2 font-medium">Title</th>
                    <th scope="col" className="px-3 py-2 font-medium">Speakers</th>
                    <th scope="col" className="px-3 py-2 font-medium">Track</th>
                    <th scope="col" className="px-3 py-2 font-medium">Format</th>
                    <th scope="col" className="px-3 py-2 font-medium">Status</th>
                    <th scope="col" className="px-3 py-2 font-medium">Public</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      <Link to={sortParams("score")} className="hover:text-slate-900">
                        Score{filters.sort === "score" ? (filters.dir === "desc" ? " v" : " ^") : ""}
                      </Link>
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <Link to={sortParams("submitted")} className="hover:text-slate-900">
                        Submitted{filters.sort === "submitted" ? (filters.dir === "desc" ? " v" : " ^") : ""}
                      </Link>
                    </th>
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
                          aria-label={`Select ${row.title}`}
                          className="accent-accent"
                        />
                      </td>
                      <td className="h-10 px-3 font-mono text-xs text-slate-500">{row.friendlyId}</td>
                      <td className="max-w-[320px] px-3">
                        <Link
                          to={`/admin/${params.eventId}/submissions/${row.id}`}
                          className="block truncate font-medium text-slate-900 hover:text-accent"
                        >
                          {row.title}
                        </Link>
                      </td>
                      <td className="max-w-[180px] truncate px-3 text-slate-900">{row.speakers}</td>
                      <td className="px-3 text-slate-500">{row.trackName ?? ""}</td>
                      <td className="px-3 text-slate-500">{row.formatName ?? ""}</td>
                      <td className="px-3">
                        <StatusBadge statusKey={row.statusKey ?? "pending"} label={row.statusLabel ?? "Pending"} />
                      </td>
                      <td className="px-3">
                        <PublicStateBadge state={row.publicState} />
                      </td>
                      <td className="px-3 text-right tabular-nums text-slate-900">
                        {row.scoreAvg != null ? (
                          <>
                            {formatScore(row.scoreAvg)} <span className="text-slate-400">({row.scoreCount})</span>
                          </>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 text-slate-500">{row.submittedAt ? formatDate(row.submittedAt, event.timezone) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2.5">
                <p className="text-[13px] text-slate-500">{selected.size} selected</p>
                <button type="submit" name="intent" value="bulk-accept-queue" className={buttonSecondary}>
                  Move to Accept Queue
                </button>
                <button type="submit" name="intent" value="bulk-decline-queue" className={buttonSecondary}>
                  Move to Decline Queue
                </button>
                <span className="mx-1 text-slate-300">|</span>
                <select name="statusId" aria-label="Set status" className={`${selectClass} w-40 flex-none`}>
                  {statusRows.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                    </option>
                  ))}
                </select>
                <button type="submit" name="intent" value="bulk-set-status" className={buttonSecondary}>
                  Set status
                </button>
                <span className="mx-1 text-slate-300">|</span>
                <button type="submit" name="intent" value="bulk-hold" className={buttonSecondary}>
                  Hold from public
                </button>
                <button type="submit" name="intent" value="bulk-publish" className={buttonSecondary}>
                  Publish to public
                </button>
              </div>
            ) : null}
          </Form>
        )}
      </Card>
    </>
  );
}
