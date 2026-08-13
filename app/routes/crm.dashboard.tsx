// CRM overview: org-wide counts and the analytics that tell an organizer who is
// actually in their database. Every widget links into the directory filtered the
// same way, so a number is never a dead end.

import { Link } from "react-router";
import type { Route } from "./+types/crm.dashboard";
import { requireOrganizer } from "../lib/session.server";
import { crmDashboard, crmViewer } from "../lib/crm.server";
import { STAGE_LABEL } from "../lib/crm-view";
import { formatDate } from "../lib/format";
import { Card, PageHeader, buttonPrimary, buttonSecondary } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Speaker CRM" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  return { data: await crmDashboard(await crmViewer(user)) };
}

function Kpi({ label, value, to }: { label: string; value: number; to?: string }) {
  const body = (
    <>
      <p className="text-[13px] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
    </>
  );
  return (
    <Card className="p-4">
      {to ? (
        <Link to={to} className="block hover:text-accent">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

function BarList({
  title,
  rows,
  hrefFor,
}: {
  title: string;
  rows: { name: string; count: number }[];
  hrefFor: (name: string) => string;
}) {
  const max = rows.reduce((peak, row) => Math.max(peak, row.count), 0) || 1;
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-slate-500">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-2">
                <Link to={hrefFor(row.name)} className="truncate text-[13px] font-medium text-slate-900 hover:text-accent">
                  {row.name}
                </Link>
                <span className="shrink-0 text-[13px] tabular-nums text-slate-500">{row.count}</span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.round((row.count / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function CrmDashboard({ loaderData }: Route.ComponentProps) {
  const { data } = loaderData;

  return (
    <>
      <PageHeader
        title="Speaker CRM"
        description="Every speaker and contact this organization has worked with, across all events."
        actions={
          <>
            <Link to="/crm/import" className={buttonSecondary}>
              Import CSV
            </Link>
            <Link to="/crm/contacts/new" className={buttonPrimary}>
              Add contact
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5 [&>*]:min-w-0">
        <Kpi label="Contacts" value={data.totalContacts} to="/crm/contacts" />
        <Kpi label="Events" value={data.totalEvents} to="/admin" />
        <Kpi label="Returning speakers" value={data.returningSpeakers} to="/crm/contacts?hasEvent=yes" />
        <Kpi label="In the pipeline" value={data.inPipeline} to="/crm/pipeline" />
        <Kpi label="Not on any event" value={data.withoutEvent} to="/crm/contacts?hasEvent=no" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <BarList title="Top companies" rows={data.topCompanies} hrefFor={(name) => `/crm/contacts?company=${encodeURIComponent(name)}`} />
        <BarList title="Top job titles" rows={data.topTitles} hrefFor={(name) => `/crm/contacts?title=${encodeURIComponent(name)}`} />

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Sourcing pipeline</h2>
          <ul className="mt-3 space-y-1.5">
            {data.byStage.map((row) => (
              <li key={row.stage} className="flex items-baseline justify-between gap-2">
                <Link to={`/crm/pipeline#${row.stage}`} className="text-[13px] text-slate-900 hover:text-accent">
                  {STAGE_LABEL[row.stage]}
                </Link>
                <span className="text-[13px] tabular-nums text-slate-500">{row.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold text-slate-900">Recently added</h2>
        {data.recentContacts.length === 0 ? (
          <p className="mt-2 text-[13px] text-slate-500">The database is empty. Import a CSV or add a contact.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {data.recentContacts.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-2 py-2">
                <Link to={`/crm/contacts/${row.id}`} className="text-[13px] font-medium text-slate-900 hover:text-accent">
                  {row.name}
                  {row.company ? <span className="ml-2 font-normal text-slate-500">{row.company}</span> : null}
                </Link>
                <span className="text-[13px] text-slate-500">{formatDate(row.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
