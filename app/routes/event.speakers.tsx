// The speaker roster. Search, filters, bulk select with bulk actions, CSV export and
// import, per-speaker completion counts so progress is readable without opening rows.

import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import { and, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/event.speakers";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { querySpeakers } from "../lib/speakers.server";
import { SPEAKER_STATUS_LABEL, type SpeakerStatus } from "../lib/labels";
import { getTemplate, queueBulk } from "../lib/comms.server";
import { events, eventContacts, fileUploads } from "../../database/schema";
import {
  Card,
  EmptyState,
  ErrorNotice,
  Notice,
  PageHeader,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Speakers" }];
}

const FLAGS: { value: string; label: string }[] = [
  { value: "", label: "All speakers" },
  { value: "accepted", label: "Has an accepted session" },
  { value: "no_headshot", label: "Missing headshot" },
  { value: "no_bio", label: "Missing bio" },
  { value: "tasks_incomplete", label: "Incomplete tasks" },
  { value: "files_incomplete", label: "Missing files" },
];

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
    status: url.searchParams.get("status") ?? "",
    flag: url.searchParams.get("flag") ?? "",
  };

  const rows = await querySpeakers(eventId, filters);
  const total = (await querySpeakers(eventId, {})).length;

  // Headshot thumbnails need the upload id, not the blob key.
  const keys = rows.map((row) => row.headshotBlobKey).filter((key): key is string => key != null);
  const headshotRows =
    keys.length > 0
      ? await db
          .select({ id: fileUploads.id, blobKey: fileUploads.blobKey })
          .from(fileUploads)
          .where(inArray(fileUploads.blobKey, keys))
          .all()
      : [];
  const headshotIdByKey = Object.fromEntries(headshotRows.map((row) => [row.blobKey, row.id]));

  // Set by the CSV importer's redirect so the roster itself reports the outcome.
  const imported = url.searchParams.get("imported");
  const importNotice = imported
    ? `Imported ${imported} new, updated ${url.searchParams.get("updated") ?? 0}, skipped ${url.searchParams.get("skipped") ?? 0}.`
    : null;

  return { event, rows, filters, total, headshotIdByKey, importNotice };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const ids = form.getAll("ids").map(Number).filter(Number.isInteger);
  if (ids.length === 0) return { error: "Select at least one speaker.", notice: null };

  if (intent === "set-status") {
    const status = String(form.get("status") ?? "") as SpeakerStatus;
    if (!["invited", "confirmed", "declined"].includes(status)) return { error: "Choose a status.", notice: null };
    await db
      .update(eventContacts)
      .set({ status })
      .where(and(eq(eventContacts.eventId, eventId), inArray(eventContacts.contactId, ids)));
    return {
      error: null,
      notice: `Set ${ids.length} ${ids.length === 1 ? "speaker" : "speakers"} to ${SPEAKER_STATUS_LABEL[status]}.`,
    };
  }

  if (intent === "invite") {
    const speakers = (await querySpeakers(eventId, {})).filter((row) => ids.includes(row.contactId));
    const template = await getTemplate(eventId, "portal_invite");
    const queued = await queueBulk({
      event,
      templateKey: "portal_invite",
      subject: template.subject,
      body: template.body,
      recipients: speakers.map((speaker) => ({
        person: {
          contactId: speaker.contactId,
          name: speaker.name,
          firstName: speaker.firstName,
          email: speaker.email,
        },
      })),
    });
    return { error: null, notice: `Queued ${queued} portal ${queued === 1 ? "invite" : "invites"}. See Communications.` };
  }

  return { error: null, notice: null };
}

export default function Speakers({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, rows, filters, total, headshotIdByKey, importNotice } = loaderData;
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

  const emailHref = `${base}/speakers/email?${new URLSearchParams({
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.flag ? { flag: filters.flag } : {}),
    ...(selected.size > 0 ? { ids: [...selected].join(",") } : {}),
  }).toString()}`;

  return (
    <>
      <PageHeader
        title="Speakers"
        description={`${total} ${total === 1 ? "speaker" : "speakers"} on the roster for ${event.name}`}
        actions={
          <>
            <Link to={`${base}/speakers/import`} className={buttonSecondary}>
              Import CSV
            </Link>
            <Link to={`${base}/speakers/new`} className={buttonPrimary}>
              Add speaker
            </Link>
          </>
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}
      {importNotice ? <Notice>{importNotice}</Notice> : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Form method="get" className="flex flex-1 flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Search name, email, or company"
              aria-label="Search speakers"
              className={`${inputClass} w-64 flex-none`}
            />
            <select name="status" defaultValue={filters.status} aria-label="Filter by status" className={`${selectClass} w-40 flex-none`}>
              <option value="">Any status</option>
              <option value="invited">Invited</option>
              <option value="confirmed">Confirmed</option>
              <option value="declined">Declined</option>
            </select>
            <select name="flag" defaultValue={filters.flag} aria-label="Filter by completeness" className={`${selectClass} w-52 flex-none`}>
              {FLAGS.map((flag) => (
                <option key={flag.value} value={flag.value}>
                  {flag.label}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonSecondary}>
              Filter
            </button>
          </Form>
          <Link to={emailHref} className={buttonSecondary}>
            Email {selected.size > 0 ? `${selected.size} selected` : "this list"}
          </Link>
          <a href={`${base}/speakers/export.csv?${searchParams.toString()}`} className={buttonSecondary}>
            Export CSV
          </a>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            message={total === 0 ? "No speakers yet. Add one, or import a CSV." : "No speakers match this filter."}
            action={
              total === 0 ? (
                <Link to={`${base}/speakers/new`} className={buttonPrimary}>
                  Add speaker
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Form method="post">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[13px]">
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
                    <th scope="col" className="px-3 py-2 font-medium">Title and company</th>
                    <th scope="col" className="px-3 py-2 font-medium">Email</th>
                    <th scope="col" className="px-3 py-2 font-medium">Status</th>
                    <th scope="col" className="px-3 py-2 font-medium">Sessions</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Tasks</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Files</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const headshotId = row.headshotBlobKey ? headshotIdByKey[row.headshotBlobKey] : undefined;
                    return (
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
                          <span className="flex items-center gap-2">
                            <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-50">
                              {headshotId ? (
                                <img src={`/files/${headshotId}?inline=1`} alt="" className="h-full w-full object-cover" />
                              ) : null}
                            </span>
                            <Link to={`${base}/speakers/${row.contactId}`} className="font-medium text-slate-900 hover:text-accent">
                              {row.name}
                            </Link>
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate px-3 text-slate-500">
                          {[row.title, row.company].filter(Boolean).join(", ")}
                        </td>
                        <td className="max-w-[200px] truncate px-3 text-slate-500">{row.email}</td>
                        <td className="px-3 text-slate-900">{SPEAKER_STATUS_LABEL[row.status]}</td>
                        <td className="max-w-[200px] truncate px-3 text-slate-500">
                          {row.sessionTitles.length === 0
                            ? "None"
                            : `${row.sessionTitles.length} (${row.acceptedCount} accepted)`}
                        </td>
                        <td className="px-3 text-right tabular-nums text-slate-900">
                          {row.tasksDone}/{row.tasksTotal}
                        </td>
                        <td className="px-3 text-right tabular-nums text-slate-900">
                          {row.filesDone}/{row.filesTotal}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2.5">
                <p className="text-[13px] text-slate-500">{selected.size} selected</p>
                <select name="status" aria-label="Set speaker status" className={`${selectClass} w-40 flex-none`}>
                  <option value="confirmed">Confirmed</option>
                  <option value="invited">Invited</option>
                  <option value="declined">Declined</option>
                </select>
                <button type="submit" name="intent" value="set-status" className={buttonSecondary}>
                  Set status
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="invite"
                  className={buttonSecondary}
                  onClick={(e) => {
                    if (!confirm(`This emails ${selected.size} ${selected.size === 1 ? "speaker" : "speakers"} a portal invite. Send now?`)) {
                      e.preventDefault();
                    }
                  }}
                >
                  Send portal invite
                </button>
              </div>
            ) : null}
          </Form>
        )}
      </Card>
    </>
  );
}
