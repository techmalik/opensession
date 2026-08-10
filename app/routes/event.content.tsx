// Deliverables dashboard: every speaker against every file request, with filters and
// a bulk reminder for whoever is still outstanding.

import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.content";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { deliverableMatrix } from "../lib/tasks.server";
import { getTemplate, queueBulk } from "../lib/comms.server";
import { escapeHtml } from "../lib/email";
import { formatDate } from "../lib/format";
import { contacts, events } from "../../database/schema";
import {
  ApprovalBadge,
  Card,
  EmptyState,
  ErrorNotice,
  Notice,
  PageHeader,
  SubNav,
  TaskBadge,
  buttonPrimary,
  buttonSecondary,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Deliverables" }];
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
  const filter = url.searchParams.get("filter") ?? "";
  const requestFilter = Number(url.searchParams.get("request") ?? 0) || null;

  const matrix = await deliverableMatrix(eventId);
  const requests = requestFilter ? matrix.requests.filter((r) => r.id === requestFilter) : matrix.requests;
  const requestIds = new Set(requests.map((r) => r.id));

  const rows = matrix.speakers
    .map((speaker) => {
      const cells = matrix.cells.filter((cell) => cell.contactId === speaker.contactId && requestIds.has(cell.requestId));
      return {
        ...speaker,
        cells,
        done: cells.filter((cell) => cell.status === "done").length,
        overdue: cells.filter((cell) => cell.status === "overdue").length,
        total: cells.length,
      };
    })
    .filter((row) => row.total > 0)
    .filter((row) =>
      filter === "incomplete"
        ? row.done < row.total
        : filter === "complete"
          ? row.done === row.total
          : filter === "overdue"
            ? row.overdue > 0
            : true
    );

  return {
    event,
    requests,
    allRequests: matrix.requests,
    rows,
    filter,
    requestFilter,
    totalCells: matrix.cells.length,
    totalDone: matrix.cells.filter((cell) => cell.status === "done").length,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select({ id: events.id, name: events.name, timezone: events.timezone }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const form = await request.formData();
  if (String(form.get("intent")) !== "remind") return { error: null, notice: null };

  const ids = form.getAll("ids").map(Number).filter(Number.isInteger);
  if (ids.length === 0) return { error: "Select at least one speaker.", notice: null };

  const matrix = await deliverableMatrix(eventId);
  const template = await getTemplate(eventId, "deliverables_reminder");

  const recipients = [];
  for (const contactId of ids) {
    const outstanding = matrix.cells.filter((cell) => cell.contactId === contactId && cell.status !== "done");
    if (outstanding.length === 0) continue;
    const contact = await db.select().from(contacts).where(eq(contacts.id, contactId)).get();
    if (!contact) continue;

    const items = outstanding.map((cell) => {
      const fileRequest = matrix.requests.find((r) => r.id === cell.requestId);
      const due = fileRequest?.dueAt ? `, due ${formatDate(fileRequest.dueAt, event.timezone)}` : "";
      return `<li>${escapeHtml(fileRequest?.title ?? "Deliverable")}${escapeHtml(due)}</li>`;
    });

    recipients.push({
      person: {
        contactId,
        name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
        firstName: contact.firstName,
        email: contact.email,
      },
      extras: { task_list: `<ul>${items.join("")}</ul>` },
    });
  }

  if (recipients.length === 0) return { error: "Everyone selected is up to date.", notice: null };

  const queued = await queueBulk({
    event,
    templateKey: "deliverables_reminder",
    subject: template.subject,
    body: template.body,
    recipients,
  });

  return { error: null, notice: `Queued ${queued} reminder ${queued === 1 ? "email" : "emails"}. See Communications.` };
}

export default function Deliverables({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, requests, allRequests, rows, filter, requestFilter, totalCells, totalDone } = loaderData;
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
    setSelected((prev) => (prev.size === rows.length ? new Set<number>() : new Set(rows.map((r) => r.contactId))));

  const hrefWith = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    return `?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Deliverables"
        description={`${totalDone} of ${totalCells} requested files received for ${event.name}.`}
        actions={
          <Link to={`${base}/content/requests`} className={buttonPrimary}>
            New file request
          </Link>
        }
      />

      <SubNav
        current={`${base}/content`}
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
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { value: "", label: "All" },
              { value: "incomplete", label: "Incomplete" },
              { value: "overdue", label: "Overdue" },
              { value: "complete", label: "Complete" },
            ].map((option) => (
              <Link
                key={option.value}
                to={hrefWith("filter", option.value)}
                className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium ${
                  filter === option.value ? "border-accent text-accent" : "border-slate-200 text-slate-500 hover:text-slate-900"
                }`}
              >
                {option.label}
              </Link>
            ))}
          </div>
          <span className="mx-1 text-slate-300">|</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to={hrefWith("request", "")}
              className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium ${
                !requestFilter ? "border-accent text-accent" : "border-slate-200 text-slate-500 hover:text-slate-900"
              }`}
            >
              Every request
            </Link>
            {allRequests.map((fileRequest) => (
              <Link
                key={fileRequest.id}
                to={hrefWith("request", String(fileRequest.id))}
                className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium ${
                  requestFilter === fileRequest.id
                    ? "border-accent text-accent"
                    : "border-slate-200 text-slate-500 hover:text-slate-900"
                }`}
              >
                {fileRequest.title}
              </Link>
            ))}
          </div>
        </div>

        {requests.length === 0 ? (
          <EmptyState
            message="No file requests yet. Create one to start collecting slides, headshots, or anything else."
            action={
              <Link to={`${base}/content/requests`} className={buttonPrimary}>
                New file request
              </Link>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState message="No speakers match this filter." />
        ) : (
          <Form method="post">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
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
                    <th scope="col" className="px-3 py-2 font-medium">Speaker</th>
                    {requests.map((fileRequest) => (
                      <th key={fileRequest.id} scope="col" className="px-3 py-2 font-medium">
                        {fileRequest.title}
                        <span className="block font-normal text-slate-400">
                          {fileRequest.dueAt ? `due ${formatDate(fileRequest.dueAt, event.timezone)}` : "no due date"}
                        </span>
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-2 text-right font-medium">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.contactId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-3">
                        <input
                          type="checkbox"
                          name="ids"
                          value={row.contactId}
                          checked={selected.has(row.contactId)}
                          onChange={() => toggle(row.contactId)}
                          aria-label={`Select ${row.name}`}
                          className="accent-accent"
                        />
                      </td>
                      <td className="h-10 px-3">
                        <Link to={`${base}/speakers/${row.contactId}`} className="font-medium text-slate-900 hover:text-accent">
                          {row.name}
                        </Link>
                      </td>
                      {requests.map((fileRequest) => {
                        const cell = row.cells.find((c) => c.requestId === fileRequest.id);
                        if (!cell) return <td key={fileRequest.id} className="px-3 text-slate-400">n/a</td>;
                        return (
                          <td key={fileRequest.id} className="px-3">
                            {cell.uploadId ? (
                              <span className="flex flex-col gap-0.5">
                                <Link to={`${base}/content/uploads/${cell.uploadId}`} className="font-medium text-accent hover:underline">
                                  {cell.filename} v{cell.version}
                                </Link>
                                {cell.approval ? <ApprovalBadge approval={cell.approval} /> : null}
                              </span>
                            ) : (
                              <TaskBadge status={cell.status} />
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 text-right tabular-nums text-slate-900">
                        {row.done}/{row.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2.5">
                <p className="text-[13px] text-slate-500">{selected.size} selected</p>
                <button
                  type="submit"
                  name="intent"
                  value="remind"
                  className={buttonSecondary}
                  onClick={(e) => {
                    if (!confirm(`This emails up to ${selected.size} ${selected.size === 1 ? "speaker" : "speakers"} about outstanding files. Send now?`)) {
                      e.preventDefault();
                    }
                  }}
                >
                  Send reminder
                </button>
              </div>
            ) : null}
          </Form>
        )}
      </Card>
    </>
  );
}
