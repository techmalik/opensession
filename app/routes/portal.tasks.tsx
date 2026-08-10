// One list for everything the organizers are waiting on: mark-complete tasks and
// file requests, both with their due dates and overdue state.

import { Form, Link, useSubmit } from "react-router";
import { and, eq } from "drizzle-orm";
import type { Route } from "./+types/portal.tasks";
import { getDb } from "../lib/db.server";
import {
  requireSpeaker,
  myFileRequest,
  myFileRequests,
  myTasks,
  saveSpeakerUpload,
  UPLOAD_ACCEPT,
  UPLOAD_HELP,
} from "../lib/portal.server";
import { formatDate } from "../lib/format";
import { taskCompletions } from "../../database/schema";
import {
  AppBar,
  ApprovalBadge,
  Card,
  EmptyState,
  ErrorNotice,
  Notice,
  PortalNav,
  TaskBadge,
  buttonPrimary,
  buttonSecondary,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "My tasks | Your portal" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, contactId } = await requireSpeaker(request);
  return {
    user,
    tasks: await myTasks(contactId),
    requests: await myFileRequests(contactId),
    uploadHelp: UPLOAD_HELP,
    uploadAccept: UPLOAD_ACCEPT,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { user, contactId } = await requireSpeaker(request);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "toggle-task") {
    const taskId = Number(form.get("taskId") ?? 0);
    const done = String(form.get("done") ?? "") === "1";

    // Only tasks that actually apply to this speaker can be completed.
    const mine = await myTasks(contactId);
    if (!mine.some((task) => task.id === taskId)) return { error: "That task is not assigned to you.", notice: null };

    const existing = await db
      .select({ id: taskCompletions.id })
      .from(taskCompletions)
      .where(and(eq(taskCompletions.taskId, taskId), eq(taskCompletions.contactId, contactId)))
      .get();

    const values = { status: done ? ("done" as const) : ("todo" as const), completedAt: done ? new Date() : null };
    if (existing) await db.update(taskCompletions).set(values).where(eq(taskCompletions.id, existing.id));
    else await db.insert(taskCompletions).values({ taskId, contactId, ...values });

    return { error: null, notice: done ? "Task marked complete." : "Task marked incomplete." };
  }

  if (intent === "upload") {
    const requestId = Number(form.get("requestId") ?? 0);
    const fileRequest = await myFileRequest(contactId, requestId);
    if (!fileRequest) return { error: "That file request is not assigned to you.", notice: null };

    const file = form.get("file");
    if (!(file instanceof File)) return { error: "Choose a file to upload.", notice: null };

    const result = await saveSpeakerUpload({ contactId, userId: user.id, request: fileRequest, file });
    if ("error" in result) return { error: result.error, notice: null };
    return { error: null, notice: `Uploaded ${file.name} as version ${result.version}.` };
  }

  return { error: null, notice: null };
}

export default function PortalTasks({ loaderData, actionData }: Route.ComponentProps) {
  const { user, tasks, requests, uploadHelp, uploadAccept } = loaderData;
  const submit = useSubmit();
  const total = tasks.length + requests.length;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="OpenSession" userName={user.name} homeTo="/portal" />

      <main className="mx-auto w-full max-w-[960px] px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">My tasks</h1>
        <p className="mt-1 text-sm text-slate-500">Everything the organizers are waiting on from you.</p>

        <div className="mt-5">
          <PortalNav current="/portal/tasks" />
        </div>

        {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
        {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

        {total === 0 ? (
          <Card>
            <EmptyState message="No tasks assigned to you yet." />
          </Card>
        ) : null}

        {tasks.length > 0 ? (
          <Card>
            <div className="border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">To do</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {tasks.map((task) => (
                <li key={task.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <Form method="post" className="pt-0.5">
                      <input type="hidden" name="intent" value="toggle-task" />
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="done" value={task.done ? "0" : "1"} />
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={(event) => submit(event.currentTarget.form, { method: "post" })}
                        aria-label={task.done ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
                        className="h-5 w-5 accent-accent"
                      />
                    </Form>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${task.done ? "text-slate-500 line-through" : "text-slate-900"}`}>
                        {task.title}
                      </p>
                      {task.description ? <p className="mt-0.5 text-[13px] text-slate-500">{task.description}</p> : null}
                      <p className="mt-1 text-[13px] text-slate-500">
                        {task.eventName}
                        {task.dueAt ? `, due ${formatDate(task.dueAt, task.timezone)}` : ", no due date"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 pl-8">
                    <TaskBadge status={task.done ? "done" : task.overdue ? "overdue" : "todo"} />
                    <Form method="post">
                      <input type="hidden" name="intent" value="toggle-task" />
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="done" value={task.done ? "0" : "1"} />
                      <button type="submit" className={buttonSecondary}>
                        {task.done ? "Mark incomplete" : "Mark complete"}
                      </button>
                    </Form>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {requests.length > 0 ? (
          <Card className="mt-5">
            <div className="border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">Files to upload</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">{uploadHelp}</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {requests.map((fileRequest) => (
                <li key={fileRequest.id} className="px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{fileRequest.title}</p>
                      {fileRequest.instructions ? (
                        <p className="mt-0.5 text-[13px] text-slate-500">{fileRequest.instructions}</p>
                      ) : null}
                      <p className="mt-1 text-[13px] text-slate-500">
                        {fileRequest.eventName}
                        {fileRequest.dueAt ? `, due ${formatDate(fileRequest.dueAt, fileRequest.timezone)}` : ", no due date"}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <TaskBadge
                        status={fileRequest.latestUploadId ? "done" : fileRequest.overdue ? "overdue" : "todo"}
                      />
                    </div>
                  </div>

                  {fileRequest.latestUploadId ? (
                    <p className="mt-2 text-[13px] text-slate-500">
                      <Link to={`/portal/files/${fileRequest.id}`} className="font-medium text-accent hover:underline">
                        {fileRequest.latestFilename}
                      </Link>{" "}
                      v{fileRequest.latestVersion} of {fileRequest.versionCount}
                      {fileRequest.approval ? (
                        <span className="ml-2 align-middle">
                          <ApprovalBadge approval={fileRequest.approval} />
                        </span>
                      ) : null}
                    </p>
                  ) : null}

                  <Form method="post" encType="multipart/form-data" className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="intent" value="upload" />
                    <input type="hidden" name="requestId" value={fileRequest.id} />
                    <input
                      type="file"
                      name="file"
                      accept={uploadAccept}
                      aria-label={`Upload a file for ${fileRequest.title}`}
                      required
                      className="block max-w-full text-sm text-slate-900 file:mr-3 file:h-9 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-900"
                    />
                    <button type="submit" className={buttonPrimary}>
                      {fileRequest.latestUploadId ? "Upload new version" : "Upload"}
                    </button>
                  </Form>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </main>
    </div>
  );
}
