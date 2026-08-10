// File requests: what is being collected, from whom, by when, with an optional
// sample file speakers can download as a reference.

import { Form, Link, useSearchParams } from "react-router";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/event.content.requests";
import { bindings, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { listFileRequests, listSpeakerRefs } from "../lib/tasks.server";
import { AUDIENCE_LABEL, type Audience } from "../lib/labels";
import { newBlobKey, putFile } from "../lib/storage";
import { formatDate, fromDateInputValue, toDateInputValue } from "../lib/format";
import { events, fileRequestAssignees, fileRequests, fileUploads } from "../../database/schema";
import {
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Notice,
  PageHeader,
  SubNav,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
  textareaClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "File requests" }];
}

const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;

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

  const requests = await listFileRequests(eventId);
  const uploads = await db
    .select({ id: fileUploads.id, requestId: fileUploads.requestId })
    .from(fileUploads)
    .where(eq(fileUploads.eventId, eventId))
    .all();
  const uploadCount = new Map<number, number>();
  for (const upload of uploads) {
    if (upload.requestId != null) uploadCount.set(upload.requestId, (uploadCount.get(upload.requestId) ?? 0) + 1);
  }

  return {
    event,
    requests: requests.map((row) => ({ ...row, uploadCount: uploadCount.get(row.id) ?? 0 })),
    roster: await listSpeakerRefs(eventId),
  };
}

async function setAssignees(requestId: number, contactIds: number[]): Promise<void> {
  const db = getDb();
  await db.delete(fileRequestAssignees).where(eq(fileRequestAssignees.requestId, requestId));
  if (contactIds.length > 0) {
    await db.insert(fileRequestAssignees).values(contactIds.map((contactId) => ({ requestId, contactId })));
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "delete") {
    const requestId = Number(form.get("requestId") ?? 0);
    await db.delete(fileRequests).where(and(eq(fileRequests.id, requestId), eq(fileRequests.eventId, eventId)));
    await db.delete(fileRequestAssignees).where(eq(fileRequestAssignees.requestId, requestId));
    return { error: null, notice: "File request deleted. Uploads already received are kept." };
  }

  if (intent !== "create" && intent !== "update") return { error: null, notice: null };

  const title = String(form.get("title") ?? "").trim();
  if (!title) return { error: "Enter a title.", notice: null };

  const appliesToRaw = String(form.get("appliesTo") ?? "accepted_speakers");
  const appliesTo: Audience = ["all_speakers", "accepted_speakers", "selected"].includes(appliesToRaw)
    ? (appliesToRaw as Audience)
    : "accepted_speakers";
  const assignees = form.getAll("assignees").map(Number).filter(Number.isInteger);
  if (appliesTo === "selected" && assignees.length === 0) {
    return { error: "Pick at least one speaker, or choose a different audience.", notice: null };
  }

  const sample = form.get("sample");
  let sampleBlobKey: string | undefined;
  let sampleFilename: string | undefined;
  if (sample instanceof File && sample.size > 0) {
    if (sample.size > MAX_SAMPLE_BYTES) return { error: "The sample file is larger than 10 MB.", notice: null };
    const key = newBlobKey(`sample-${eventId}`, sample.name || "sample");
    await putFile(bindings, key, await sample.arrayBuffer(), sample.type || "application/octet-stream");
    sampleBlobKey = key;
    sampleFilename = sample.name || "sample";
  }

  const values = {
    title,
    instructions: String(form.get("instructions") ?? "").trim() || null,
    dueAt: fromDateInputValue(form.get("dueAt")),
    appliesTo,
    ...(sampleBlobKey ? { sampleBlobKey, sampleFilename } : {}),
  };

  if (intent === "create") {
    const created = await db
      .insert(fileRequests)
      .values({ eventId, ...values, createdAt: new Date() })
      .returning({ id: fileRequests.id })
      .get();
    await setAssignees(created.id, appliesTo === "selected" ? assignees : []);
    return { error: null, notice: `File request "${title}" created.` };
  }

  const requestId = Number(form.get("requestId") ?? 0);
  await db.update(fileRequests).set(values).where(and(eq(fileRequests.id, requestId), eq(fileRequests.eventId, eventId)));
  await setAssignees(requestId, appliesTo === "selected" ? assignees : []);
  return { error: null, notice: `File request "${title}" saved.` };
}

export default function FileRequests({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, requests, roster } = loaderData;
  const [searchParams] = useSearchParams();
  const base = `/admin/${params.eventId}`;
  const editingId = Number(searchParams.get("edit") ?? 0);
  const editing = requests.find((row) => row.id === editingId) ?? null;

  return (
    <>
      <PageHeader
        title="File requests"
        description={`What ${event.name} is collecting from its speakers, and by when.`}
      />

      <SubNav
        current={`${base}/content/requests`}
        items={[
          { to: `${base}/portals`, label: "Tasks" },
          { to: `${base}/content`, label: "Deliverables" },
          { to: `${base}/content/requests`, label: "File requests" },
          { to: `${base}/content/review`, label: "Content review" },
        ]}
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Requests ({requests.length})</h2>
          </div>
          {requests.length === 0 ? (
            <EmptyState message="No file requests yet. Create one with the form beside this list." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {requests.map((fileRequest) => (
                <li key={fileRequest.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{fileRequest.title}</p>
                      {fileRequest.instructions ? (
                        <p className="mt-0.5 text-[13px] text-slate-500">{fileRequest.instructions}</p>
                      ) : null}
                      <p className="mt-1 text-[13px] text-slate-500">
                        {fileRequest.dueAt ? `Due ${formatDate(fileRequest.dueAt, event.timezone)}` : "No due date"},{" "}
                        {AUDIENCE_LABEL[fileRequest.appliesTo]}, {fileRequest.assignees.length} assigned,{" "}
                        {fileRequest.uploadCount} uploaded
                      </p>
                      {fileRequest.sampleFilename ? (
                        <p className="mt-1 text-[13px] text-slate-500">Sample: {fileRequest.sampleFilename}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Link to={`?edit=${fileRequest.id}`} className={buttonSecondary}>
                        Edit
                      </Link>
                      <Form method="post" onSubmit={(e) => !confirm(`Delete "${fileRequest.title}"?`) && e.preventDefault()}>
                        <input type="hidden" name="requestId" value={fileRequest.id} />
                        <button type="submit" name="intent" value="delete" className={buttonGhost}>
                          Delete
                        </button>
                      </Form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">{editing ? "Edit file request" : "New file request"}</h2>
          <Form method="post" encType="multipart/form-data" className="mt-3 space-y-4" key={editing?.id ?? "new"}>
            <input type="hidden" name="intent" value={editing ? "update" : "create"} />
            {editing ? <input type="hidden" name="requestId" value={editing.id} /> : null}

            <Field label="Title" name="title" required>
              <input id="title" name="title" defaultValue={editing?.title ?? ""} className={inputClass} required />
            </Field>
            <Field label="Instructions" name="instructions" help="Format, aspect ratio, naming, anything the speaker needs to know.">
              <textarea
                id="instructions"
                name="instructions"
                rows={3}
                defaultValue={editing?.instructions ?? ""}
                className={textareaClass}
              />
            </Field>
            <Field label="Due date" name="dueAt">
              <input id="dueAt" name="dueAt" type="date" defaultValue={toDateInputValue(editing?.dueAt)} className={inputClass} />
            </Field>
            <Field label="Request from" name="appliesTo" help="Selected speakers uses the list below.">
              <select id="appliesTo" name="appliesTo" defaultValue={editing?.appliesTo ?? "all_speakers"} className={selectClass}>
                <option value="all_speakers">All speakers</option>
                <option value="accepted_speakers">Speakers with an accepted session</option>
                <option value="selected">Selected speakers</option>
              </select>
            </Field>
            <Field label="Sample file" name="sample" help="Optional. Speakers can download it as a reference.">
              <input
                id="sample"
                name="sample"
                type="file"
                className="block w-full text-sm text-slate-900 file:mr-3 file:h-9 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-900"
              />
            </Field>

            <fieldset>
              <legend className="block text-sm font-medium text-slate-900">Selected speakers</legend>
              {roster.length === 0 ? (
                <p className="mt-1 text-[13px] text-slate-500">No speakers on the roster yet.</p>
              ) : (
                <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                  {roster.map((speaker) => (
                    <li key={speaker.contactId}>
                      <label className="flex items-center gap-2 text-[13px] text-slate-900">
                        <input
                          type="checkbox"
                          name="assignees"
                          value={speaker.contactId}
                          defaultChecked={editing?.appliesTo === "selected" && editing.assignees.includes(speaker.contactId)}
                          className="accent-accent"
                        />
                        {speaker.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>

            <div className="flex items-center gap-2">
              <button type="submit" className={buttonPrimary}>
                {editing ? "Save request" : "Create request"}
              </button>
              {editing ? (
                <Link to={`${base}/content/requests`} className={buttonSecondary}>
                  Cancel
                </Link>
              ) : null}
            </div>
          </Form>
        </Card>
      </div>
    </>
  );
}
