// Speaker portal tasks: create them, assign them, and read the completion matrix
// without opening a single speaker record.

import { Form, Link, useSearchParams } from "react-router";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/event.portals";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { listSpeakerRefs, taskMatrix } from "../lib/tasks.server";
import { AUDIENCE_LABEL, type Audience } from "../lib/labels";
import { formatDate, fromDateInputValue, toDateInputValue } from "../lib/format";
import { events, portalTasks, taskAssignees, taskCompletions } from "../../database/schema";
import {
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Notice,
  PageHeader,
  SubNav,
  TaskBadge,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  selectClass,
  textareaClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Portal tasks" }];
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
  const matrix = await taskMatrix(eventId);
  const roster = await listSpeakerRefs(eventId);

  const speakers = matrix.speakers
    .map((speaker) => {
      const cells = matrix.cells.filter((cell) => cell.contactId === speaker.contactId);
      return {
        ...speaker,
        cells,
        done: cells.filter((cell) => cell.status === "done").length,
        total: cells.length,
      };
    })
    .filter((speaker) => speaker.total > 0)
    .filter((speaker) =>
      filter === "incomplete" ? speaker.done < speaker.total : filter === "complete" ? speaker.done === speaker.total : true
    );

  return {
    event,
    tasks: matrix.tasks,
    roster,
    speakers,
    filter,
    totalAssigned: matrix.cells.length,
    totalDone: matrix.cells.filter((cell) => cell.status === "done").length,
  };
}

async function setAssignees(taskId: number, contactIds: number[]): Promise<void> {
  const db = getDb();
  await db.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
  if (contactIds.length > 0) {
    await db.insert(taskAssignees).values(contactIds.map((contactId) => ({ taskId, contactId })));
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // Assignee and completion rows carry no event of their own, so a posted task id is
  // resolved against the route event first and only the verified row is used.
  const ownedTask = (taskId: number) =>
    db
      .select({ id: portalTasks.id })
      .from(portalTasks)
      .where(and(eq(portalTasks.id, taskId), eq(portalTasks.eventId, eventId)))
      .get();

  if (intent === "create" || intent === "update") {
    const title = String(form.get("title") ?? "").trim();
    if (!title) return { error: "Enter a task title.", notice: null };

    const appliesToRaw = String(form.get("appliesTo") ?? "accepted_speakers");
    const appliesTo: Audience = ["all_speakers", "accepted_speakers", "selected"].includes(appliesToRaw)
      ? (appliesToRaw as Audience)
      : "accepted_speakers";
    const assignees = form.getAll("assignees").map(Number).filter(Number.isInteger);
    if (appliesTo === "selected" && assignees.length === 0) {
      return { error: "Pick at least one speaker, or choose a different audience.", notice: null };
    }

    const values = {
      title,
      description: String(form.get("description") ?? "").trim() || null,
      dueAt: fromDateInputValue(form.get("dueAt")),
      appliesTo,
    };

    if (intent === "create") {
      const existing = await db.select({ sort: portalTasks.sort }).from(portalTasks).where(eq(portalTasks.eventId, eventId)).all();
      const sort = existing.reduce((max, row) => Math.max(max, row.sort), -1) + 1;
      const created = await db
        .insert(portalTasks)
        .values({ eventId, ...values, sort, createdAt: new Date() })
        .returning({ id: portalTasks.id })
        .get();
      await setAssignees(created.id, appliesTo === "selected" ? assignees : []);
      return { error: null, notice: `Task "${title}" created.` };
    }

    const owned = await ownedTask(Number(form.get("taskId") ?? 0));
    if (!owned) throw new Response("Task not found", { status: 404 });
    await db.update(portalTasks).set(values).where(eq(portalTasks.id, owned.id));
    await setAssignees(owned.id, appliesTo === "selected" ? assignees : []);
    return { error: null, notice: `Task "${title}" saved.` };
  }

  if (intent === "delete") {
    const owned = await ownedTask(Number(form.get("taskId") ?? 0));
    if (!owned) throw new Response("Task not found", { status: 404 });
    await db.delete(portalTasks).where(eq(portalTasks.id, owned.id));
    await db.delete(taskAssignees).where(eq(taskAssignees.taskId, owned.id));
    await db.delete(taskCompletions).where(eq(taskCompletions.taskId, owned.id));
    return { error: null, notice: "Task deleted." };
  }

  if (intent === "toggle") {
    const taskId = Number(form.get("taskId") ?? 0);
    const contactId = Number(form.get("contactId") ?? 0);
    const done = String(form.get("done") ?? "") === "1";

    const owned = await ownedTask(taskId);
    if (!owned) return { error: "That task does not belong to this event.", notice: null };

    const existing = await db
      .select({ id: taskCompletions.id })
      .from(taskCompletions)
      .where(and(eq(taskCompletions.taskId, taskId), eq(taskCompletions.contactId, contactId)))
      .get();
    const values = { status: done ? ("done" as const) : ("todo" as const), completedAt: done ? new Date() : null };
    if (existing) await db.update(taskCompletions).set(values).where(eq(taskCompletions.id, existing.id));
    else await db.insert(taskCompletions).values({ taskId, contactId, ...values });
    return { error: null, notice: null };
  }

  return { error: null, notice: null };
}

export default function Portals({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, tasks, roster, speakers, filter, totalAssigned, totalDone } = loaderData;
  const [searchParams] = useSearchParams();
  const base = `/admin/${params.eventId}`;
  const editingId = Number(searchParams.get("edit") ?? 0);
  const editing = tasks.find((task) => task.id === editingId) ?? null;

  const filterHref = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("filter", value);
    else next.delete("filter");
    next.delete("edit");
    return `?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Portal tasks"
        description={`${totalDone} of ${totalAssigned} assigned tasks complete across the ${event.name} roster.`}
      />

      <SubNav
        current={`${base}/portals`}
        items={[
          { to: `${base}/portals`, label: "Tasks" },
          { to: `${base}/content`, label: "Deliverables" },
          { to: `${base}/content/requests`, label: "File requests" },
          { to: `${base}/content/review`, label: "Content review" },
        ]}
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">Tasks ({tasks.length})</h2>
            </div>
            {tasks.length === 0 ? (
              <EmptyState message="No tasks yet. Create one to give speakers a checklist in their portal." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {tasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{task.title}</p>
                      <p className="text-[13px] text-slate-500">
                        {task.dueAt ? `Due ${formatDate(task.dueAt, event.timezone)}` : "No due date"},{" "}
                        {AUDIENCE_LABEL[task.appliesTo]}, {task.assignees.length}{" "}
                        {task.assignees.length === 1 ? "assignee" : "assignees"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Link to={`?edit=${task.id}`} className={buttonSecondary}>
                        Edit
                      </Link>
                      <Form method="post" onSubmit={(e) => !confirm(`Delete "${task.title}"?`) && e.preventDefault()}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <button type="submit" name="intent" value="delete" className={buttonGhost}>
                          Delete
                        </button>
                      </Form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">Completion</h2>
              <div className="flex items-center gap-1.5">
                {[
                  { value: "", label: "All" },
                  { value: "incomplete", label: "Incomplete" },
                  { value: "complete", label: "Complete" },
                ].map((option) => (
                  <Link
                    key={option.value}
                    to={filterHref(option.value)}
                    className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[13px] font-medium ${
                      filter === option.value ? "border-accent text-accent" : "border-slate-200 text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {option.label}
                  </Link>
                ))}
              </div>
            </div>

            {speakers.length === 0 || tasks.length === 0 ? (
              <EmptyState message="Nothing to track yet. Add a task, and add speakers to the roster." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th scope="col" className="px-3 py-2 font-medium">Speaker</th>
                      {tasks.map((task) => (
                        <th key={task.id} scope="col" className="px-3 py-2 font-medium">
                          {task.title}
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2 text-right font-medium">Done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {speakers.map((speaker) => (
                      <tr key={speaker.contactId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="h-10 px-3">
                          <Link to={`${base}/speakers/${speaker.contactId}`} className="font-medium text-slate-900 hover:text-accent">
                            {speaker.name}
                          </Link>
                        </td>
                        {tasks.map((task) => {
                          const cell = speaker.cells.find((c) => c.taskId === task.id);
                          if (!cell) return <td key={task.id} className="px-3 text-slate-400">n/a</td>;
                          return (
                            <td key={task.id} className="px-3">
                              <Form method="post" className="flex items-center gap-2">
                                <input type="hidden" name="intent" value="toggle" />
                                <input type="hidden" name="taskId" value={task.id} />
                                <input type="hidden" name="contactId" value={speaker.contactId} />
                                <input type="hidden" name="done" value={cell.status === "done" ? "0" : "1"} />
                                <button
                                  type="submit"
                                  className="text-left"
                                  aria-label={`${cell.status === "done" ? "Mark incomplete" : "Mark complete"}: ${task.title} for ${speaker.name}`}
                                >
                                  <TaskBadge status={cell.status} />
                                </button>
                              </Form>
                            </td>
                          );
                        })}
                        <td className="px-3 text-right tabular-nums text-slate-900">
                          {speaker.done}/{speaker.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">{editing ? "Edit task" : "New task"}</h2>
          <Form method="post" className="mt-3 space-y-4" key={editing?.id ?? "new"}>
            <input type="hidden" name="intent" value={editing ? "update" : "create"} />
            {editing ? <input type="hidden" name="taskId" value={editing.id} /> : null}

            <Field label="Title" name="title" required>
              <input id="title" name="title" defaultValue={editing?.title ?? ""} className={inputClass} required />
            </Field>
            <Field label="Description" name="description">
              <textarea id="description" name="description" rows={3} defaultValue={editing?.description ?? ""} className={textareaClass} />
            </Field>
            <Field label="Due date" name="dueAt">
              <input id="dueAt" name="dueAt" type="date" defaultValue={toDateInputValue(editing?.dueAt)} className={inputClass} />
            </Field>
            <Field label="Assign to" name="appliesTo" help="Selected speakers uses the list below.">
              <select id="appliesTo" name="appliesTo" defaultValue={editing?.appliesTo ?? "all_speakers"} className={selectClass}>
                <option value="all_speakers">All speakers</option>
                <option value="accepted_speakers">Speakers with an accepted session</option>
                <option value="selected">Selected speakers</option>
              </select>
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
                {editing ? "Save task" : "Create task"}
              </button>
              {editing ? (
                <Link to={`${base}/portals`} className={buttonSecondary}>
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
