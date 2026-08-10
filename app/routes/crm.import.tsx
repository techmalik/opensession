// Org-level CSV import. Two steps: upload, then see exactly what would change before
// anything is written. Headers map by name, and rows with no email are flagged
// rather than silently dropped.

import { Form, Link } from "react-router";
import type { Route } from "./+types/crm.import";
import { requireOrganizer } from "../lib/session.server";
import { applyImport, previewImport } from "../lib/speakers.server";
import { parseCsv } from "../lib/format";
import { Card, ErrorNotice, Field, Notice, PageHeader, buttonPrimary, buttonSecondary } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Import contacts" }];
}

const MAX_CSV_BYTES = 2 * 1024 * 1024;

export async function loader({ request }: Route.LoaderArgs) {
  await requireOrganizer(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  await requireOrganizer(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "preview") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file.", preview: null, csv: null, notice: null };
    if (file.size > MAX_CSV_BYTES) return { error: "That file is larger than 2 MB.", preview: null, csv: null, notice: null };
    const csv = await file.text();
    const table = parseCsv(csv);
    if (table.length < 2) return { error: "That file has no data rows.", preview: null, csv: null, notice: null };

    // eventId 0: import into the org database only, not onto any event roster.
    const preview = await previewImport(0, table);
    if (!preview.mapped.includes("email")) {
      return { error: "No email column found. Contacts are matched by email.", preview: null, csv: null, notice: null };
    }
    return { error: null, preview, csv, notice: null };
  }

  if (intent === "commit") {
    const csv = String(form.get("csv") ?? "");
    const table = parseCsv(csv);
    if (table.length < 2) return { error: "Nothing to import.", preview: null, csv: null, notice: null };
    const preview = await previewImport(0, table);
    const result = await applyImport(0, preview);
    return {
      error: null,
      preview: null,
      csv: null,
      notice: `Imported ${result.created} new, updated ${result.updated}, skipped ${result.skipped}.`,
    };
  }

  return { error: null, preview: null, csv: null, notice: null };
}

export default function CrmImport({ actionData }: Route.ComponentProps) {
  const preview = actionData?.preview ?? null;
  const counts = preview
    ? {
        create: preview.rows.filter((row) => row.action === "create").length,
        update: preview.rows.filter((row) => row.action === "update").length,
        skip: preview.rows.filter((row) => row.action === "skip").length,
      }
    : null;

  return (
    <>
      <div className="mb-2 text-[13px]">
        <Link to="/crm/contacts" className="text-slate-500 hover:text-slate-900">
          Directory
        </Link>
        <span className="mx-1 text-slate-400">/</span>
        <span className="text-slate-900">Import CSV</span>
      </div>

      <PageHeader
        title="Import contacts"
        description="Rows are matched to existing contacts by email, so re-importing the same file updates rather than duplicates."
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? (
        <Notice>
          {actionData.notice}{" "}
          <Link to="/crm/contacts" className="font-medium text-accent hover:underline">
            Open the directory
          </Link>
        </Notice>
      ) : null}

      <div className="max-w-[840px] space-y-4">
        <Card className="p-4">
          <Form method="post" encType="multipart/form-data" className="space-y-3">
            <input type="hidden" name="intent" value="preview" />
            <Field
              label="CSV file"
              name="file"
              help="Columns recognised: first name, last name, name, email, job title, company, bio, twitter, linkedin, website, phone."
            >
              <input id="file" name="file" type="file" accept=".csv,text/csv" className="text-sm" />
            </Field>
            <button type="submit" className={buttonSecondary}>
              Preview import
            </button>
          </Form>
        </Card>

        {preview && counts ? (
          <Card>
            <div className="border-b border-slate-200 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                {preview.rows.length} {preview.rows.length === 1 ? "row" : "rows"}: {counts.create} new,{" "}
                {counts.update} {counts.update === 1 ? "update" : "updates"}, {counts.skip} skipped
              </h2>
              {preview.unmapped.length > 0 ? (
                <p className="mt-0.5 text-[13px] text-slate-500">Columns ignored: {preview.unmapped.join(", ")}</p>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="px-3 py-2 font-medium">Action</th>
                    <th scope="col" className="px-3 py-2 font-medium">Name</th>
                    <th scope="col" className="px-3 py-2 font-medium">Email</th>
                    <th scope="col" className="px-3 py-2 font-medium">Company</th>
                    <th scope="col" className="px-3 py-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={index} className="border-b border-slate-100 last:border-0">
                      <td className={`h-9 px-3 font-medium ${row.action === "skip" ? "text-amber-600" : "text-slate-900"}`}>
                        {row.action}
                      </td>
                      <td className="px-3 text-slate-900">{`${row.row.firstName} ${row.row.lastName}`.trim()}</td>
                      <td className="px-3 text-slate-500">{row.row.email}</td>
                      <td className="px-3 text-slate-500">{row.row.company}</td>
                      <td className="px-3 text-slate-500">{row.reason ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-200 px-4 py-2.5">
              <Form method="post">
                <input type="hidden" name="intent" value="commit" />
                <input type="hidden" name="csv" value={actionData?.csv ?? ""} />
                <button type="submit" className={buttonPrimary}>
                  Import {counts.create + counts.update} contacts
                </button>
              </Form>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
