// Duplicate review and merge. Same name, different record, which is what happens
// when the same speaker is imported twice under two addresses. The merge is
// field by field, and it cannot be undone, so the UI says so before the button.

import { Form, Link } from "react-router";
import type { Route } from "./+types/crm.duplicates";
import { requireOrganizer } from "../lib/session.server";
import { contactsByIds, duplicateGroups, mergeContacts } from "../lib/crm.server";
import { Card, EmptyState, ErrorNotice, Notice, PageHeader, buttonDanger, buttonSecondary } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Duplicates" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const url = new URL(request.url);
  const compare = url.searchParams.get("compare");
  const ids = (compare ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);

  return {
    groups: await duplicateGroups(),
    compare: ids.length === 2 ? await contactsByIds(ids) : [],
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireOrganizer(request);
  const form = await request.formData();
  if (String(form.get("intent")) !== "merge") return { error: null, notice: null };

  const primaryId = Number(form.get("primaryId") ?? 0);
  const duplicateId = Number(form.get("duplicateId") ?? 0);
  if (!primaryId || !duplicateId || primaryId === duplicateId) {
    return { error: "Pick two different records, and which one survives.", notice: null };
  }

  const merged = await mergeContacts(primaryId, duplicateId, {
    firstName: String(form.get("firstName") ?? "").trim(),
    lastName: String(form.get("lastName") ?? "").trim(),
    email: String(form.get("email") ?? "").trim(),
    title: String(form.get("title") ?? "").trim(),
    company: String(form.get("company") ?? "").trim(),
    bio: String(form.get("bio") ?? "").trim(),
  });

  return merged
    ? { error: null, notice: "Merged. One record now carries the sessions, events, notes, and mail of both." }
    : { error: "Those records could not be merged.", notice: null };
}

const FIELDS = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "title", label: "Job title" },
  { key: "company", label: "Company" },
  { key: "bio", label: "Bio" },
] as const;

export default function CrmDuplicates({ loaderData, actionData }: Route.ComponentProps) {
  const { groups, compare } = loaderData;
  const [left, right] = compare;

  return (
    <>
      <PageHeader
        title="Duplicates"
        description="Contacts that share a name. Merging keeps one record and moves everything the other one owns onto it."
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      {left && right ? (
        <Card className="mb-4 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Compare and merge</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Pick the surviving record, then the value to keep for each field. This cannot be undone.
          </p>

          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="merge" />

            <fieldset className="mb-3">
              <legend className="text-[13px] font-medium text-slate-900">Which record survives</legend>
              <div className="mt-1 flex flex-wrap gap-4">
                {[left, right].map((row, index) => (
                  <label key={row.id} className="flex items-center gap-2 text-[13px] text-slate-900">
                    <input
                      type="radio"
                      name="primaryId"
                      value={row.id}
                      defaultChecked={index === 0}
                      className="accent-accent"
                      required
                    />
                    {row.email}
                    <span className="text-slate-500">
                      ({row.eventCount} {row.eventCount === 1 ? "event" : "events"}, {row.sessionCount} sessions)
                    </span>
                  </label>
                ))}
              </div>
              <input type="hidden" name="duplicateId" value={right.id} />
              <p className="mt-1 text-[13px] text-slate-500">
                Choosing the second record swaps the roles: the other one is deleted.
              </p>
            </fieldset>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="px-2 py-2 font-medium">Field</th>
                    <th scope="col" className="px-2 py-2 font-medium">{left.email}</th>
                    <th scope="col" className="px-2 py-2 font-medium">{right.email}</th>
                    <th scope="col" className="px-2 py-2 font-medium">Keep</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.map((field) => {
                    const a = String(left[field.key] ?? "");
                    const b = String(right[field.key] ?? "");
                    return (
                      <tr key={field.key} className="border-b border-slate-100 last:border-0 align-top">
                        <td className="px-2 py-2 text-slate-500">{field.label}</td>
                        <td className="max-w-[220px] px-2 py-2 text-slate-900">{a || <span className="text-slate-400">empty</span>}</td>
                        <td className="max-w-[220px] px-2 py-2 text-slate-900">{b || <span className="text-slate-400">empty</span>}</td>
                        <td className="px-2 py-2">
                          <select name={field.key} defaultValue={a || b} className="h-8 w-full rounded-md border border-slate-200 px-2 text-[13px]">
                            {a ? <option value={a}>{a.slice(0, 60)}</option> : null}
                            {b && b !== a ? <option value={b}>{b.slice(0, 60)}</option> : null}
                            <option value="">Leave empty</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="submit" className={buttonDanger}>
                Merge these two records
              </button>
              <Link to="/crm/duplicates" className={buttonSecondary}>
                Cancel
              </Link>
            </div>
          </Form>
        </Card>
      ) : null}

      <Card>
        {groups.length === 0 ? (
          <EmptyState message="No two contacts share a name. Nothing to merge." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {groups.map((group) => (
              <li key={group.map((row) => row.id).join("-")} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-slate-900">{group[0].name}</p>
                  <p className="text-[13px] text-slate-500">
                    {group.map((row) => `${row.email} (${row.eventCount} events, ${row.sessionCount} sessions)`).join("  vs  ")}
                  </p>
                </div>
                <Link
                  to={`/crm/duplicates?compare=${group[0].id},${group[1].id}`}
                  className={buttonSecondary}
                >
                  Compare and merge
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
