// Saved views. A dynamic segment re-runs its filters every time it is opened; a
// curated one keeps the exact contacts that were selected when it was saved.

import { Form, Link } from "react-router";
import type { Route } from "./+types/crm.segments";
import { requireOrganizer } from "../lib/session.server";
import { deleteSegment, listSegments } from "../lib/crm.server";
import { Card, EmptyState, Notice, PageHeader, buttonSecondary } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Segments" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOrganizer(request);
  return { segments: await listSegments() };
}

export async function action({ request }: Route.ActionArgs) {
  await requireOrganizer(request);
  const form = await request.formData();
  if (String(form.get("intent")) !== "delete") return { notice: null };
  await deleteSegment(Number(form.get("segmentId") ?? 0));
  return { notice: "Segment deleted." };
}

function describe(filters: Record<string, unknown>): string {
  const parts = Object.entries(filters)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${value}`);
  return parts.length > 0 ? parts.join(", ") : "Everyone";
}

export default function CrmSegments({ loaderData, actionData }: Route.ComponentProps) {
  const { segments } = loaderData;

  return (
    <>
      <PageHeader
        title="Segments"
        description="Saved directory views. Build one by filtering the directory and saving the result."
        actions={
          <Link to="/crm/contacts" className={buttonSecondary}>
            Go to the directory
          </Link>
        }
      />

      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <Card>
        {segments.length === 0 ? (
          <EmptyState
            message="No segments yet. Filter the directory, then use Save segment at the bottom of the table."
            action={
              <Link to="/crm/contacts" className={buttonSecondary}>
                Go to the directory
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {segments.map((segment) => (
              <li key={segment.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <Link to={`/crm/contacts?segment=${segment.id}`} className="text-[13px] font-medium text-slate-900 hover:text-accent">
                    {segment.name}
                  </Link>
                  <p className="text-[13px] text-slate-500">
                    {segment.kind === "dynamic" ? `Dynamic, ${describe(segment.filters)}` : "Curated list"}, {segment.count}{" "}
                    {segment.count === 1 ? "member" : "members"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/crm/contacts?segment=${segment.id}`} className={buttonSecondary}>
                    Open
                  </Link>
                  <Form method="post">
                    <input type="hidden" name="segmentId" value={segment.id} />
                    <button type="submit" name="intent" value="delete" className="text-[13px] font-medium text-slate-500 hover:text-rose-600">
                      Delete
                    </button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
