// Content review queue, which doubles as the files library: every upload for the
// event with its request, speaker, session, version, and review state.

import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import { and, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/event.content.review";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { queryUploads } from "../lib/content.server";
import { listFileRequests } from "../lib/tasks.server";
import { formatBytes, formatDateTime } from "../lib/format";
import { events, fileUploads } from "../../database/schema";
import {
  ApprovalBadge,
  Card,
  EmptyState,
  ErrorNotice,
  Notice,
  PageHeader,
  SubNav,
  buttonSecondary,
  inputSized,
  selectSized,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Content review" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const filters = {
    q: url.searchParams.get("q") ?? "",
    approval: url.searchParams.get("approval") ?? "",
    requestId: Number(url.searchParams.get("request") ?? 0) || undefined,
    scope: url.searchParams.get("scope") ?? "",
  };

  const rows = await queryUploads(eventId, filters);
  const all = await queryUploads(eventId);

  return {
    event,
    rows,
    filters,
    total: all.length,
    pending: all.filter((row) => row.approval === "pending").length,
    requests: (await listFileRequests(eventId)).map((row) => ({ id: row.id, title: row.title })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const ids = form.getAll("ids").map(Number).filter(Number.isInteger);
  if (ids.length === 0) return { error: "Select at least one file.", notice: null };

  if (intent === "bulk-approve") {
    await db
      .update(fileUploads)
      .set({ approval: "approved", reviewedByUserId: user.id, reviewedAt: new Date() })
      .where(and(eq(fileUploads.eventId, eventId), inArray(fileUploads.id, ids)));
    return { error: null, notice: `Approved ${ids.length} ${ids.length === 1 ? "file" : "files"}.` };
  }

  return { error: null, notice: null };
}

export default function ContentReview({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, rows, filters, total, pending, requests } = loaderData;
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const base = `/admin/${params.eventId}`;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => (prev.size === rows.length ? new Set<number>() : new Set(rows.map((r) => r.id))));

  const exportQuery = new URLSearchParams(searchParams);
  if (selected.size > 0) exportQuery.set("ids", [...selected].join(","));

  return (
    <>
      <PageHeader
        title="Content review"
        description={`${total} ${total === 1 ? "file" : "files"} uploaded for ${event.name}, ${pending} waiting for review.`}
      />

      <SubNav
        current={`${base}/content/review`}
        items={[
          { to: `${base}/portals`, label: "Tasks" },
          { to: `${base}/content`, label: "Deliverables" },
          { to: `${base}/content/requests`, label: "File requests" },
          { to: `${base}/content/review`, label: "Content review" },
        ]}
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Form method="get" className="flex flex-1 flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Search file, speaker, or session"
              aria-label="Search files"
              className={`${inputSized} w-60 flex-none`}
            />
            <select name="request" defaultValue={filters.requestId ?? ""} aria-label="Filter by request" className={`${selectSized} w-48 flex-none`}>
              <option value="">All requests</option>
              {requests.map((fileRequest) => (
                <option key={fileRequest.id} value={fileRequest.id}>
                  {fileRequest.title}
                </option>
              ))}
            </select>
            <select name="approval" defaultValue={filters.approval} aria-label="Filter by review state" className={`${selectSized} w-40 flex-none`}>
              <option value="">Any state</option>
              <option value="pending">Pending review</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
            <select name="scope" defaultValue={filters.scope} aria-label="Filter by version" className={`${selectSized} w-40 flex-none`}>
              <option value="">All versions</option>
              <option value="latest">Latest only</option>
            </select>
            <button type="submit" className={buttonSecondary}>
              Filter
            </button>
          </Form>
          <a href={`${base}/content/review/export.csv?${searchParams.toString()}`} className={buttonSecondary}>
            Export CSV
          </a>
          <a href={`${base}/content/review/export.zip?${exportQuery.toString()}`} className={buttonSecondary}>
            Download ZIP
          </a>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            message={total === 0 ? "No files uploaded yet. Speakers upload from their portal." : "No files match this filter."}
          />
        ) : (
          <Form method="post">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-[13px]">
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
                    <th scope="col" className="px-3 py-2 font-medium">File</th>
                    <th scope="col" className="px-3 py-2 font-medium">Request</th>
                    <th scope="col" className="px-3 py-2 font-medium">Speaker</th>
                    <th scope="col" className="px-3 py-2 font-medium">Session</th>
                    <th scope="col" className="px-3 py-2 font-medium">Version</th>
                    <th scope="col" className="px-3 py-2 font-medium">Review</th>
                    <th scope="col" className="px-3 py-2 font-medium">Uploaded</th>
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
                          aria-label={`Select ${row.filename}`}
                          className="accent-accent"
                        />
                      </td>
                      <td className="h-10 max-w-[220px] px-3">
                        <Link
                          to={`${base}/content/uploads/${row.id}`}
                          className="block truncate font-medium text-slate-900 hover:text-accent"
                        >
                          {row.filename}
                        </Link>
                        <span className="text-slate-500">{formatBytes(row.size)}</span>
                      </td>
                      <td className="max-w-[160px] truncate px-3 text-slate-500">{row.requestTitle ?? "Profile photo"}</td>
                      <td className="max-w-[150px] truncate px-3 text-slate-900">
                        {row.contactId ? (
                          <Link to={`${base}/speakers/${row.contactId}`} className="hover:text-accent">
                            {row.speakerName}
                          </Link>
                        ) : (
                          row.speakerName
                        )}
                      </td>
                      <td className="max-w-[180px] truncate px-3 text-slate-500">
                        {row.sessionId ? (
                          <Link to={`${base}/submissions/${row.sessionId}`} className="hover:text-accent">
                            {row.sessionTitle}
                          </Link>
                        ) : (
                          "None"
                        )}
                      </td>
                      <td className="px-3 tabular-nums text-slate-900">
                        v{row.version} of {row.versionCount}
                        {row.isLatest ? <span className="ml-1 text-slate-500">latest</span> : null}
                      </td>
                      <td className="px-3">
                        <ApprovalBadge approval={row.approval} />
                      </td>
                      <td className="px-3 text-slate-500">{formatDateTime(row.createdAt, event.timezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2.5">
                <p className="text-[13px] text-slate-500">{selected.size} selected</p>
                <button type="submit" name="intent" value="bulk-approve" className={buttonSecondary}>
                  Approve
                </button>
                <a href={`${base}/content/review/export.zip?${exportQuery.toString()}`} className={buttonSecondary}>
                  Download selected as ZIP
                </a>
                <p className="text-[13px] text-slate-500">Denying needs a comment, so it happens on the file itself.</p>
              </div>
            ) : null}
          </Form>
        )}
      </Card>
    </>
  );
}
