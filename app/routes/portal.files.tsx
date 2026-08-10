// Every file this speaker has uploaded, and every request still waiting on one.

import { Link } from "react-router";
import { desc, eq } from "drizzle-orm";
import type { Route } from "./+types/portal.files";
import { getDb } from "../lib/db.server";
import { requireSpeaker, myFileRequests } from "../lib/portal.server";
import { formatBytes, formatDate, formatDateTime } from "../lib/format";
import { fileRequests, fileUploads } from "../../database/schema";
import { AppBar, ApprovalBadge, Card, EmptyState, PortalNav, TaskBadge, buttonSecondary } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "My files | Your portal" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, contactId } = await requireSpeaker(request);
  const db = getDb();

  const requests = await myFileRequests(contactId);
  const uploads = await db
    .select({
      id: fileUploads.id,
      requestId: fileUploads.requestId,
      requestTitle: fileRequests.title,
      filename: fileUploads.filename,
      size: fileUploads.size,
      version: fileUploads.version,
      approval: fileUploads.approval,
      createdAt: fileUploads.createdAt,
    })
    .from(fileUploads)
    .leftJoin(fileRequests, eq(fileUploads.requestId, fileRequests.id))
    .where(eq(fileUploads.contactId, contactId))
    .orderBy(desc(fileUploads.createdAt))
    .all();

  return { user, requests, uploads };
}

export default function PortalFiles({ loaderData }: Route.ComponentProps) {
  const { user, requests, uploads } = loaderData;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="OpenSession" userName={user.name} homeTo="/portal" />

      <main className="mx-auto w-full max-w-[960px] px-6 py-8">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">My files</h1>
        <p className="mt-1 text-sm text-slate-500">What has been requested, what you sent, and how review went.</p>

        <div className="mt-5">
          <PortalNav current="/portal/files" />
        </div>

        <Card>
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Requested from you</h2>
          </div>
          {requests.length === 0 ? (
            <EmptyState message="No file requests for you yet." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {requests.map((fileRequest) => (
                <li key={fileRequest.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link
                      to={`/portal/files/${fileRequest.id}`}
                      className="text-sm font-medium text-slate-900 hover:text-accent"
                    >
                      {fileRequest.title}
                    </Link>
                    <p className="text-[13px] text-slate-500">
                      {fileRequest.eventName}
                      {fileRequest.dueAt ? `, due ${formatDate(fileRequest.dueAt, fileRequest.timezone)}` : ""}
                      {fileRequest.versionCount > 0
                        ? `, ${fileRequest.versionCount} ${fileRequest.versionCount === 1 ? "version" : "versions"}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {fileRequest.approval ? <ApprovalBadge approval={fileRequest.approval} /> : null}
                    <TaskBadge status={fileRequest.latestUploadId ? "done" : fileRequest.overdue ? "overdue" : "todo"} />
                    <Link to={`/portal/files/${fileRequest.id}`} className={buttonSecondary}>
                      {fileRequest.latestUploadId ? "Open" : "Upload"}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="mt-5">
          <div className="border-b border-slate-200 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Uploads</h2>
          </div>
          {uploads.length === 0 ? (
            <EmptyState message="You have not uploaded anything yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="px-4 py-2 font-medium">File</th>
                    <th scope="col" className="px-4 py-2 font-medium">Request</th>
                    <th scope="col" className="px-4 py-2 font-medium">Version</th>
                    <th scope="col" className="px-4 py-2 font-medium">Review</th>
                    <th scope="col" className="px-4 py-2 font-medium">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((upload) => (
                    <tr key={upload.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="h-10 px-4">
                        <a href={`/files/${upload.id}`} className="font-medium text-accent hover:underline">
                          {upload.filename}
                        </a>
                        <span className="ml-2 text-slate-500">{formatBytes(upload.size)}</span>
                      </td>
                      <td className="px-4 text-slate-500">
                        {upload.requestId ? (
                          <Link to={`/portal/files/${upload.requestId}`} className="hover:text-accent">
                            {upload.requestTitle}
                          </Link>
                        ) : (
                          "Profile photo"
                        )}
                      </td>
                      <td className="px-4 tabular-nums text-slate-900">v{upload.version}</td>
                      <td className="px-4">
                        <ApprovalBadge approval={upload.approval} />
                      </td>
                      <td className="px-4 text-slate-500">{formatDateTime(upload.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
