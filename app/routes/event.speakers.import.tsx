// CSV import in two steps: upload, then preview what would change before anything is
// written. Headers auto-map by name; the raw file rides along in a hidden field so
// the preview and the commit see byte-identical input.

import { Form, Link, redirect } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/event.speakers.import";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { applyImport, previewImport } from "../lib/speakers.server";
import { parseCsv } from "../lib/format";
import { events } from "../../database/schema";
import { Breadcrumbs, Card, ErrorNotice, Field, PageHeader, buttonPrimary, buttonSecondary } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Import speakers" }];
}

const MAX_CSV_BYTES = 2 * 1024 * 1024;

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const event = await db.select({ id: events.id, name: events.name }).from(events).where(eq(events.id, eventId)).get();
  if (!event) throw new Response("Event not found", { status: 404 });
  return { event };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "preview") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file.", preview: null, csv: null };
    if (file.size > MAX_CSV_BYTES) return { error: "That file is larger than 2 MB.", preview: null, csv: null };
    const csv = await file.text();
    const table = parseCsv(csv);
    if (table.length < 2) return { error: "That file has no data rows.", preview: null, csv: null };
    const preview = await previewImport(eventId, table);
    if (!preview.headers.some((_, index) => preview.mapped[index] === "email")) {
      return { error: "No email column found. The importer matches speakers by email.", preview: null, csv: null };
    }
    return { error: null, preview, csv };
  }

  if (intent === "commit") {
    const csv = String(form.get("csv") ?? "");
    const table = parseCsv(csv);
    if (table.length < 2) return { error: "Nothing to import.", preview: null, csv: null };
    const preview = await previewImport(eventId, table);
    const result = await applyImport(eventId, preview);
    const query = new URLSearchParams({
      imported: String(result.created),
      updated: String(result.updated),
      skipped: String(result.skipped),
    });
    throw redirect(`/admin/${params.eventId}/speakers?${query.toString()}`);
  }

  return { error: null, preview: null, csv: null };
}

export default function ImportSpeakers({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event } = loaderData;
  const preview = actionData?.preview ?? null;
  const base = `/admin/${params.eventId}`;

  const counts = preview
    ? {
        create: preview.rows.filter((row) => row.action === "create").length,
        update: preview.rows.filter((row) => row.action === "update").length,
        skip: preview.rows.filter((row) => row.action === "skip").length,
      }
    : null;

  return (
    <>
      <Breadcrumbs items={[{ to: `${base}/speakers`, label: "Speakers" }, { label: "Import CSV" }]} />

      <PageHeader
        title="Import speakers"
        description={`Add speakers to ${event.name} from a spreadsheet. Nothing is written until you confirm.`}
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}

      {!preview ? (
        <Card className="max-w-[640px] p-4">
          <Form method="post" encType="multipart/form-data" className="space-y-4">
            <input type="hidden" name="intent" value="preview" />
            <Field
              label="CSV file"
              name="file"
              required
              help="Recognised headers: first_name, last_name, name, email, title, company, bio, twitter, linkedin, website, phone, dietary, tshirt, travel, notes. Email is required and is how existing speakers are matched."
            >
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                className="block w-full text-sm text-slate-900 file:mr-3 file:h-9 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:text-sm file:font-medium file:text-slate-900"
              />
            </Field>
            <button type="submit" className={buttonPrimary}>
              Preview import
            </button>
          </Form>
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-4">
            <h2 className="text-sm font-semibold text-slate-900">Column mapping</h2>
            <ul className="mt-2 space-y-1 text-[13px]">
              {preview.headers.map((header, index) => (
                <li key={`${header}-${index}`} className="text-slate-900">
                  <span className="font-mono text-xs text-slate-500">{header}</span>
                  <span className="mx-2 text-slate-400">to</span>
                  {preview.mapped[index] ? (
                    <span>{preview.mapped[index]}</span>
                  ) : (
                    <span className="text-slate-500">ignored</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                {preview.rows.length} {preview.rows.length === 1 ? "row" : "rows"}
              </h2>
              <p className="text-[13px] text-slate-500">
                {counts?.create} to add, {counts?.update} to update, {counts?.skip} skipped
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="px-3 py-2 font-medium">Action</th>
                    <th scope="col" className="px-3 py-2 font-medium">Name</th>
                    <th scope="col" className="px-3 py-2 font-medium">Email</th>
                    <th scope="col" className="px-3 py-2 font-medium">Title and company</th>
                    <th scope="col" className="px-3 py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={index} className="border-b border-slate-100 last:border-0">
                      <td className="h-10 px-3 text-slate-900">
                        {row.action === "create" ? "Add" : row.action === "update" ? "Update" : "Skip"}
                      </td>
                      <td className="px-3 text-slate-900">{`${row.row.firstName} ${row.row.lastName}`.trim()}</td>
                      <td className="px-3 text-slate-500">{row.row.email || "missing"}</td>
                      <td className="max-w-[220px] truncate px-3 text-slate-500">
                        {[row.row.title, row.row.company].filter(Boolean).join(", ")}
                      </td>
                      <td className="px-3 text-slate-500">{row.reason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
              <Form method="post">
                <input type="hidden" name="intent" value="commit" />
                <input type="hidden" name="csv" value={actionData?.csv ?? ""} />
                <button type="submit" className={buttonPrimary}>
                  Import {(counts?.create ?? 0) + (counts?.update ?? 0)} rows
                </button>
              </Form>
              <Link to={`${base}/speakers/import`} className={buttonSecondary}>
                Choose a different file
              </Link>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
