import { useState } from "react";
import { Form, Link, redirect, useSearchParams } from "react-router";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Route } from "./+types/event.forms";
import { getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { createBaselineFields } from "../lib/cfp.server";
import { formatDate, slugify } from "../lib/format";
import { events, forms } from "../../database/schema";
import { Badge, Card, EmptyState, PageHeader, buttonPrimary, buttonSecondary, inputClass,
  inputSized, selectSized } from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Forms" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db
    .select({ name: events.name, slug: events.slug, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const status = url.searchParams.get("status") ?? "";

  const rows = await db
    .select({
      id: forms.id,
      name: forms.name,
      slug: forms.slug,
      status: forms.status,
      opensAt: forms.opensAt,
      closesAt: forms.closesAt,
      submissionLimit: forms.submissionLimit,
      submissionCount: sql<number>`(
        select count(*) from sessions where sessions.form_id = ${forms.id} and sessions.is_draft = 0
      )`,
    })
    .from(forms)
    .where(eq(forms.eventId, eventId))
    .orderBy(asc(forms.createdAt))
    .all();

  const filtered = rows.filter(
    (row) =>
      (!q || row.name.toLowerCase().includes(q)) &&
      (!status || row.status === status)
  );

  return { event, forms: filtered, total: rows.length };
}

async function uniqueFormSlug(eventId: number, name: string): Promise<string> {
  const db = getDb();
  const base = slugify(name) || "form";
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db
      .select({ id: forms.id })
      .from(forms)
      .where(and(eq(forms.eventId, eventId), eq(forms.slug, candidate)))
      .get();
    if (!clash) return candidate;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { error: "Enter a form name." };

    const event = await db.select({ name: events.name }).from(events).where(eq(events.id, eventId)).get();
    const created = await db
      .insert(forms)
      .values({
        eventId,
        name,
        slug: await uniqueFormSlug(eventId, name),
        type: "abstract",
        confirmationSubject: `We received your proposal for ${event?.name ?? "the event"}`,
        confirmationBody:
          "<p>Hi {speaker_name},</p><p>We received your proposal \"{talk_title}\" for {event_name}. You can edit it from your portal until the form closes.</p><p>{portal_url}</p>",
        status: "draft",
        createdAt: new Date(),
      })
      .returning({ id: forms.id })
      .get();

    await createBaselineFields(created.id, eventId);
    throw redirect(`/admin/${eventId}/forms/${created.id}`);
  }

  if (intent === "bulk-close") {
    const ids = form.getAll("ids").map(Number).filter(Number.isInteger);
    if (ids.length === 0) return { error: "Select at least one form." };
    for (const id of ids) {
      await db.update(forms).set({ status: "closed" }).where(and(eq(forms.id, id), eq(forms.eventId, eventId), ne(forms.status, "closed")));
    }
    return { error: null, notice: `Closed ${ids.length} ${ids.length === 1 ? "form" : "forms"}.` };
  }

  return { error: null };
}

const FORM_STATUS_LABEL: Record<string, string> = { draft: "Draft", published: "Published", closed: "Closed" };

export default function FormsList({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, forms: rows, total } = loaderData;
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title="Forms"
        description="Submission forms for this event. Publish one to open the call for papers."
      />

      {actionData?.error ? (
        <div role="alert" className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          {actionData.error}
        </div>
      ) : null}
      {actionData && "notice" in actionData && actionData.notice ? (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">{actionData.notice}</div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <Form method="get" className="flex flex-1 flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={searchParams.get("q") ?? ""}
              placeholder="Search forms"
              aria-label="Search forms"
              className={`${inputSized} w-56 flex-none`}
            />
            <select name="status" defaultValue={searchParams.get("status") ?? ""} aria-label="Filter by status" className={`${selectSized} w-36 flex-none`}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
            </select>
            <button type="submit" className={buttonSecondary}>
              Filter
            </button>
          </Form>
          <a href={`/admin/${params.eventId}/forms/export.csv?${searchParams.toString()}`} className={buttonSecondary}>
            Export CSV
          </a>
        </div>

        {rows.length === 0 ? (
          <EmptyState message={total === 0 ? "No forms yet. Create the call for papers below." : "No forms match this filter."} />
        ) : (
          <Form method="post">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th scope="col" className="w-8 px-3 py-2">
                    <span className="sr-only">Select</span>
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Opens</th>
                  <th scope="col" className="px-3 py-2 font-medium">Closes</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Submissions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3">
                      <input
                        type="checkbox"
                        name="ids"
                        value={row.id}
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        aria-label={`Select ${row.name}`}
                        className="accent-accent"
                      />
                    </td>
                    <td className="h-10 px-3">
                      <Link to={`/admin/${params.eventId}/forms/${row.id}`} className="font-medium text-slate-900 hover:text-accent">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-3">
                      <Badge>{FORM_STATUS_LABEL[row.status] ?? row.status}</Badge>
                    </td>
                    <td className="px-3 text-slate-500">{row.opensAt ? formatDate(row.opensAt, event.timezone) : "On publish"}</td>
                    <td className="px-3 text-slate-500">{row.closesAt ? formatDate(row.closesAt, event.timezone) : "No close date"}</td>
                    <td className="px-3 text-right tabular-nums text-slate-900">{row.submissionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selected.size > 0 ? (
              <div className="flex items-center gap-3 border-t border-slate-200 px-3 py-2.5">
                <p className="text-[13px] text-slate-500">{selected.size} selected</p>
                <button
                  type="submit"
                  name="intent"
                  value="bulk-close"
                  className={buttonSecondary}
                  onClick={(e) => {
                    if (!confirm(`Close ${selected.size} ${selected.size === 1 ? "form" : "forms"}? The public page will stop accepting submissions.`)) {
                      e.preventDefault();
                    }
                  }}
                >
                  Close selected
                </button>
              </div>
            ) : null}
          </Form>
        )}

        <Form method="post" className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-3 py-2.5">
          <input name="name" placeholder="New form name, e.g. Call for Proposals" aria-label="New form name" className={`${inputClass} min-w-64 flex-1`} />
          <button type="submit" name="intent" value="create" className={buttonPrimary}>
            Create form
          </button>
        </Form>
      </Card>
    </>
  );
}
