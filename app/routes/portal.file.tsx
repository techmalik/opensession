// One file request from the speaker's side: what was asked for, every version they
// sent, the review outcome, and the comment thread they share with the organizers.

import { Form } from "react-router";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Route } from "./+types/portal.file";
import { getDb } from "../lib/db.server";
import {
  requireSpeaker,
  myFileRequest,
  saveSpeakerUpload,
  UPLOAD_ACCEPT,
  UPLOAD_HELP,
} from "../lib/portal.server";
import { formatBytes, formatDate, formatDateTime } from "../lib/format";
import { fileComments, fileUploads, users } from "../../database/schema";
import {
  AppBar,
  ApprovalBadge,
  Breadcrumbs,
  Card,
  ErrorNotice,
  Field,
  Notice,
  PortalNav,
  buttonPrimary,
  buttonSecondary,
  textareaClass,
} from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.fileRequest ? `${loaderData.fileRequest.title} | Your portal` : "Your portal" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, contactId } = await requireSpeaker(request);
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId)) throw new Response("Not found", { status: 404 });

  const fileRequest = await myFileRequest(contactId, requestId);
  if (!fileRequest) throw new Response("Not found", { status: 404 });

  const db = getDb();
  const versions = await db
    .select()
    .from(fileUploads)
    .where(
      and(
        eq(fileUploads.requestId, requestId),
        eq(fileUploads.contactId, contactId),
        eq(fileUploads.eventId, fileRequest.eventId)
      )
    )
    .orderBy(asc(fileUploads.version))
    .all();

  const comments =
    versions.length > 0
      ? await db
          .select({
            id: fileComments.id,
            uploadId: fileComments.uploadId,
            body: fileComments.body,
            createdAt: fileComments.createdAt,
            authorName: users.name,
            authorRole: users.role,
          })
          .from(fileComments)
          .leftJoin(users, eq(fileComments.authorUserId, users.id))
          .where(inArray(fileComments.uploadId, versions.map((v) => v.id)))
          .orderBy(asc(fileComments.createdAt))
          .all()
      : [];

  return {
    user,
    fileRequest,
    versions: versions.map((version) => ({
      id: version.id,
      version: version.version,
      filename: version.filename,
      size: version.size,
      approval: version.approval,
      createdAt: version.createdAt,
      isLatest: version.version === Math.max(...versions.map((v) => v.version)),
    })),
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      authorName: comment.authorName ?? "Unknown",
      authorRole: comment.authorRole ?? "",
    })),
    uploadHelp: UPLOAD_HELP,
    uploadAccept: UPLOAD_ACCEPT,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, contactId } = await requireSpeaker(request);
  const requestId = Number(params.requestId);
  const fileRequest = await myFileRequest(contactId, requestId);
  if (!fileRequest) throw new Response("Not found", { status: 404 });

  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "upload") {
    const file = form.get("file");
    if (!(file instanceof File)) return { error: "Choose a file to upload.", notice: null };
    const result = await saveSpeakerUpload({ contactId, userId: user.id, request: fileRequest, file });
    if ("error" in result) return { error: result.error, notice: null };
    return { error: null, notice: `Uploaded ${file.name} as version ${result.version}. Review starts again at pending.` };
  }

  if (intent === "comment") {
    const body = String(form.get("body") ?? "").trim();
    if (!body) return { error: "Write something before posting.", notice: null };
    const uploadId = Number(form.get("uploadId") ?? 0);

    // The comment must land on one of this speaker's own uploads.
    const upload = await db
      .select({ id: fileUploads.id })
      .from(fileUploads)
      .where(and(eq(fileUploads.id, uploadId), eq(fileUploads.contactId, contactId)))
      .get();
    if (!upload) return { error: "That file is not yours.", notice: null };

    await db.insert(fileComments).values({ uploadId: upload.id, authorUserId: user.id, body, createdAt: new Date() });
    return { error: null, notice: "Comment posted." };
  }

  return { error: null, notice: null };
}

export default function PortalFileRequest({ loaderData, actionData }: Route.ComponentProps) {
  const { user, fileRequest, versions, comments, uploadHelp, uploadAccept } = loaderData;
  const latest = versions.find((version) => version.isLatest) ?? null;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="OpenSession" userName={user.name} homeTo="/portal" />

      <main className="mx-auto w-full max-w-[960px] px-6 py-8">
        <Breadcrumbs items={[{ to: "/portal/files", label: "My files" }, { label: fileRequest.title }]} />

        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{fileRequest.title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {fileRequest.eventName}
          {fileRequest.dueAt ? `, due ${formatDate(fileRequest.dueAt, fileRequest.timezone)}` : ""}
        </p>

        <div className="mt-5">
          <PortalNav current="/portal/files" />
        </div>

        {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
        {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

        {fileRequest.instructions ? (
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Instructions</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{fileRequest.instructions}</p>
          </Card>
        ) : null}

        <Card className="mt-4 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Upload</h2>
          <p className="mt-1 text-[13px] text-slate-500">{uploadHelp}</p>
          <Form method="post" encType="multipart/form-data" className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="intent" value="upload" />
            <input
              type="file"
              name="file"
              accept={uploadAccept}
              aria-label={`Upload a file for ${fileRequest.title}`}
              required
              className="block max-w-full text-sm text-slate-900 file:mr-3 file:h-9 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-900"
            />
            <button type="submit" className={buttonPrimary}>
              {versions.length > 0 ? "Upload new version" : "Upload"}
            </button>
          </Form>
        </Card>

        <Card className="mt-4">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Versions ({versions.length})</h2>
          </div>
          {versions.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">Nothing uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...versions].reverse().map((version) => (
                <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <a href={`/files/${version.id}`} className="font-medium text-accent hover:underline">
                        {version.filename}
                      </a>
                      <span className="ml-2 text-slate-500">
                        v{version.version}
                        {version.isLatest ? ", latest" : ""}, {formatBytes(version.size)}
                      </span>
                    </p>
                    <p className="text-[13px] text-slate-500">{formatDateTime(version.createdAt, fileRequest.timezone)}</p>
                  </div>
                  <ApprovalBadge approval={version.approval} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="mt-4 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Comments</h2>
          {comments.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No comments yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-md border border-slate-200 px-3 py-2">
                  <p className="text-[13px] text-slate-500">
                    {comment.authorName}
                    {comment.authorRole ? `, ${comment.authorRole}` : ""} on{" "}
                    {formatDateTime(comment.createdAt, fileRequest.timezone)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}

          {latest ? (
            <Form method="post" className="mt-4 space-y-3">
              <input type="hidden" name="intent" value="comment" />
              <input type="hidden" name="uploadId" value={latest.id} />
              <Field label="Add a comment" name="body">
                <textarea id="body" name="body" rows={3} className={textareaClass} required />
              </Field>
              <button type="submit" className={buttonSecondary}>
                Post comment
              </button>
            </Form>
          ) : (
            <p className="mt-3 text-[13px] text-slate-500">Upload a file first to start the thread.</p>
          )}
        </Card>
      </main>
    </div>
  );
}
