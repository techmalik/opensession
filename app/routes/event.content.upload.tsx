// One deliverable: every version the speaker sent, the review decision, and the
// comment thread they both read. Denying requires a comment, so a speaker is never
// told "denied" with no reason.

import { Form, Link } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.content.upload";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { loadUploadDetail } from "../lib/content.server";
import { formatBytes, formatDate, formatDateTime } from "../lib/format";
import { events, fileComments, fileUploads } from "../../database/schema";
import {
  ApprovalBadge,
  Breadcrumbs,
  Card,
  ErrorNotice,
  Field,
  Notice,
  PageHeader,
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  textareaClass,
} from "../components/ui";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.detail ? loaderData.detail.upload.filename : "File" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const uploadId = Number(params.uploadId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const detail = await loadUploadDetail(eventId, uploadId);
  if (!detail) throw new Response("File not found", { status: 404 });

  return { event, detail };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const uploadId = Number(params.uploadId);
  const db = getDb();

  const detail = await loadUploadDetail(eventId, uploadId);
  if (!detail) throw new Response("File not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const comment = String(form.get("comment") ?? "").trim();

  if (intent === "approve") {
    await db
      .update(fileUploads)
      .set({ approval: "approved", reviewedByUserId: user.id, reviewedAt: new Date() })
      .where(eq(fileUploads.id, uploadId));
    if (comment) {
      await db.insert(fileComments).values({ uploadId, authorUserId: user.id, body: comment, createdAt: new Date() });
    }
    return { error: null, notice: "Approved." };
  }

  if (intent === "deny") {
    if (!comment) return { error: "Denying needs a comment saying what to change.", notice: null };
    await db
      .update(fileUploads)
      .set({ approval: "denied", reviewedByUserId: user.id, reviewedAt: new Date() })
      .where(eq(fileUploads.id, uploadId));
    await db.insert(fileComments).values({ uploadId, authorUserId: user.id, body: comment, createdAt: new Date() });
    return { error: null, notice: "Denied, and the comment is visible in the speaker's portal." };
  }

  if (intent === "comment") {
    if (!comment) return { error: "Write something before posting.", notice: null };
    await db.insert(fileComments).values({ uploadId, authorUserId: user.id, body: comment, createdAt: new Date() });
    return { error: null, notice: "Comment posted." };
  }

  return { error: null, notice: null };
}

export default function UploadDetail({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, detail } = loaderData;
  const { upload, versions, comments, request: fileRequest } = detail;
  const base = `/admin/${params.eventId}`;

  return (
    <>
      <Breadcrumbs items={[{ to: `${base}/content/review`, label: "Content review" }, { label: upload.filename }]} />

      <PageHeader
        title={upload.filename}
        description={`${upload.requestTitle ?? "Profile photo"}, from ${upload.speakerName}, version ${upload.version} of ${upload.versionCount}`}
        actions={
          <a href={`/files/${upload.id}`} className={buttonSecondary}>
            Download
          </a>
        }
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Review</h2>
            <div className="mt-2">
              <ApprovalBadge approval={upload.approval} />
            </div>
            {upload.reviewedAt ? (
              <p className="mt-1 text-[13px] text-slate-500">Reviewed {formatDateTime(upload.reviewedAt, event.timezone)}</p>
            ) : null}

            <Form method="post" className="mt-4 space-y-3">
              <Field
                label="Comment"
                name="comment"
                help="Required to deny, optional to approve. The speaker sees it in their portal."
              >
                <textarea id="comment" name="comment" rows={3} className={textareaClass} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" name="intent" value="approve" className={buttonPrimary}>
                  Approve
                </button>
                <button type="submit" name="intent" value="deny" className={buttonDanger}>
                  Deny
                </button>
                <button type="submit" name="intent" value="comment" className={buttonSecondary}>
                  Comment only
                </button>
              </div>
            </Form>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Comments ({comments.length})</h2>
            {comments.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No comments yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id} className="rounded-md border border-slate-200 px-3 py-2">
                    <p className="text-[13px] text-slate-500">
                      {comment.authorName}
                      {comment.authorRole ? `, ${comment.authorRole}` : ""} on{" "}
                      {formatDateTime(comment.createdAt, event.timezone)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{comment.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <div className="border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">Versions ({versions.length})</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {versions.map((version) => (
                <li key={version.id} className="px-4 py-2.5">
                  <p className="text-sm">
                    <Link
                      to={`${base}/content/uploads/${version.id}`}
                      className={version.id === upload.id ? "font-medium text-slate-900" : "font-medium text-accent hover:underline"}
                    >
                      v{version.version}
                      {version.isLatest ? ", latest" : ""}
                    </Link>
                    <span className="ml-2 text-slate-500">{formatBytes(version.size)}</span>
                  </p>
                  <p className="text-[13px] text-slate-500">{formatDateTime(version.createdAt, event.timezone)}</p>
                  <div className="mt-1 flex items-center gap-3">
                    <ApprovalBadge approval={version.approval} />
                    <a href={`/files/${version.id}`} className="text-[13px] font-medium text-accent hover:underline">
                      Download
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {fileRequest ? (
            <Card className="p-4">
              <h2 className="text-sm font-semibold text-slate-900">Request</h2>
              <p className="mt-1 text-sm text-slate-900">{fileRequest.title}</p>
              {fileRequest.instructions ? (
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-500">{fileRequest.instructions}</p>
              ) : null}
              <p className="mt-1 text-[13px] text-slate-500">
                {fileRequest.dueAt ? `Due ${formatDate(fileRequest.dueAt, event.timezone)}` : "No due date"}
              </p>
            </Card>
          ) : null}

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Where it belongs</h2>
            <dl className="mt-2 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Speaker</dt>
                <dd className="text-right text-slate-900">
                  {upload.contactId ? (
                    <Link to={`${base}/speakers/${upload.contactId}`} className="hover:text-accent">
                      {upload.speakerName}
                    </Link>
                  ) : (
                    upload.speakerName
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Session</dt>
                <dd className="text-right text-slate-900">
                  {upload.sessionId ? (
                    <Link to={`${base}/submissions/${upload.sessionId}`} className="hover:text-accent">
                      {upload.sessionTitle}
                    </Link>
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Type</dt>
                <dd className="text-right text-slate-900">{upload.contentType}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
