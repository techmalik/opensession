// Settings > Integrations. Airtable two-way sync and the Accelevents push, with
// their real state: whether credentials exist, when each side last ran, what it
// moved, and what broke. Both degrade to setup instructions rather than errors.

import { Form, Link } from "react-router";
import type { Route } from "./+types/event.integrations";
import { eq } from "drizzle-orm";
import { bindings, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import {
  airtableBaseUrl,
  airtableConfigured,
  airtableCounts,
  airtableState,
  ensureBaseSchema,
  pullFromAirtable,
  pushToAirtable,
  resetAirtableLinks,
  AIRTABLE_TABLES,
} from "../lib/airtable.server";
import {
  accelConfigured,
  accelDryRun,
  accelState,
  pushToAccelevents,
  saveAccelConfig,
  ACCEL_DEFAULT_BASE,
  ACCEL_FIELD_MAP,
} from "../lib/accelevents.server";
import { formatDateTime } from "../lib/format";
import { events } from "../../database/schema";
import {
  Card,
  ErrorNotice,
  Field,
  Notice,
  PageHeader,
  SubNav,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  textareaClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "Integrations" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const db = getDb();

  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, eventId))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  const configured = airtableConfigured(bindings);
  const accel = await accelState();
  const dryRun = new URL(request.url).searchParams.get("dryrun") === "1" ? await accelDryRun(bindings.DB, eventId) : null;

  return {
    event,
    airtable: {
      configured,
      baseUrl: airtableBaseUrl(bindings),
      baseId: bindings.AIRTABLE_BASE_ID ?? null,
      state: await airtableState(),
      counts: configured ? await airtableCounts(bindings) : [],
      tables: Object.values(AIRTABLE_TABLES),
    },
    accel: {
      config: { ...accel.config, apiKey: accel.config.apiKey ? "set" : "" },
      configured: accelConfigured(accel),
      lastPushAt: accel.lastPushAt,
      log: accel.log,
      fieldMap: ACCEL_FIELD_MAP,
      defaultBase: ACCEL_DEFAULT_BASE,
      dryRun,
    },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  await requireOrganizer(request);
  const eventId = Number(params.eventId);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "airtable-schema") {
    if (!airtableConfigured(bindings)) return { error: "Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first.", notice: null };
    try {
      const result = await ensureBaseSchema(bindings);
      return {
        error: null,
        notice:
          result.created.length > 0
            ? `Created ${result.created.join(", ")} in the base.`
            : "The base already has every mirror table.",
      };
    } catch (err) {
      return { error: `Airtable rejected the schema call: ${String(err).slice(0, 300)}`, notice: null };
    }
  }

  if (intent === "airtable-sync") {
    if (!airtableConfigured(bindings)) return { error: "Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first.", notice: null };
    const push = await pushToAirtable(bindings);
    const pull = await pullFromAirtable(bindings);
    const errors = [...push.errors, ...pull.errors];
    return {
      error: errors.length > 0 ? errors.join(" ") : null,
      notice: `Pushed ${push.created} new and ${push.updated} changed, skipped ${push.skipped} unchanged. Pulled ${pull.updated} edits back.`,
    };
  }

  if (intent === "airtable-reset") {
    await resetAirtableLinks(bindings);
    return { error: null, notice: "Record mapping cleared. The next sync recreates every row in Airtable." };
  }

  if (intent === "accel-save") {
    const apiKey = String(form.get("apiKey") ?? "").trim();
    const config: Record<string, unknown> = {
      eventId: String(form.get("accelEventId") ?? "").trim(),
      baseUrl: String(form.get("baseUrl") ?? "").trim() || ACCEL_DEFAULT_BASE,
      enabled: form.get("enabled") === "on",
    };
    // An empty key field means "leave the stored key alone", so saving the toggle
    // does not wipe the credential.
    if (apiKey) config.apiKey = apiKey;
    await saveAccelConfig(config);
    return { error: null, notice: "Accelevents settings saved." };
  }

  if (intent === "accel-clear") {
    await saveAccelConfig({ apiKey: "", eventId: "", enabled: false });
    return { error: null, notice: "Accelevents credentials cleared." };
  }

  if (intent === "accel-push") {
    const entries = await pushToAccelevents({ DB: bindings.DB });
    if (entries.length === 0) return { error: null, notice: "Accelevents push is off, or no credentials are set." };
    const failed = entries.filter((entry) => !entry.ok);
    return {
      error: failed.length > 0 ? failed.map((entry) => entry.message).join(" ") : null,
      notice: `Push attempted for ${entries.length} ${entries.length === 1 ? "event" : "events"}. See the log below.`,
    };
  }

  return { error: null, notice: null };
}

export default function Integrations({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, airtable, accel } = loaderData;
  const base = `/admin/${params.eventId}`;

  return (
    <>
      <PageHeader title="Integrations" description={`Outbound and two-way sync for ${event.name}.`} />
      <SubNav
        items={[
          { to: `${base}/settings`, label: "Event" },
          { to: `${base}/settings/taxonomy`, label: "Tracks and formats" },
          { to: `${base}/settings/integrations`, label: "Integrations" },
        ]}
        current={`${base}/settings/integrations`}
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Airtable</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Mirrors sessions, contacts, and statuses into a base and reads team edits back. Latest write wins.
          </p>

          {!airtable.configured ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-[13px] font-medium text-slate-900">Not connected</p>
              <ol className="mt-2 list-inside list-decimal space-y-1 text-[13px] text-slate-500">
                <li>Create a personal access token at airtable.com/create/tokens with data.records:read, data.records:write, schema.bases:read, and schema.bases:write.</li>
                <li>Create or pick a base and copy its ID from the URL, the part starting with app.</li>
                <li>
                  Set both as secrets: <span className="font-mono text-xs">wrangler secret put AIRTABLE_API_KEY</span> and{" "}
                  <span className="font-mono text-xs">wrangler secret put AIRTABLE_BASE_ID</span>. Locally they go in .dev.vars.
                </li>
                <li>Redeploy, then use Create mirror tables here.</li>
              </ol>
            </div>
          ) : (
            <>
              <dl className="mt-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="text-slate-900">Connected</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Base</dt>
                  <dd>
                    {airtable.baseUrl ? (
                      <a href={airtable.baseUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent hover:underline">
                        {airtable.baseId}
                      </a>
                    ) : (
                      <span className="text-slate-900">{airtable.baseId}</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Last push</dt>
                  <dd className="text-slate-900">
                    {airtable.state.lastPushAt ? formatDateTime(new Date(airtable.state.lastPushAt), event.timezone) : "Never"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Last pull</dt>
                  <dd className="text-slate-900">
                    {airtable.state.lastPullAt ? formatDateTime(new Date(airtable.state.lastPullAt), event.timezone) : "Never"}
                  </dd>
                </div>
              </dl>

              {airtable.state.lastError ? (
                <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-[13px] text-rose-600">
                  {airtable.state.lastError}
                </p>
              ) : null}

              <table className="mt-3 w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="py-2 font-medium">Table</th>
                    <th scope="col" className="py-2 text-right font-medium">Local rows</th>
                    <th scope="col" className="py-2 text-right font-medium">Linked</th>
                  </tr>
                </thead>
                <tbody>
                  {airtable.counts.map((row) => (
                    <tr key={row.table} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 capitalize text-slate-900">{row.table}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-900">{row.local}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">{row.linked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Form method="post">
                  <button type="submit" name="intent" value="airtable-sync" className={buttonPrimary}>
                    Sync now
                  </button>
                </Form>
                <Form method="post">
                  <button type="submit" name="intent" value="airtable-schema" className={buttonSecondary}>
                    Create mirror tables
                  </button>
                </Form>
                <Form method="post">
                  <button type="submit" name="intent" value="airtable-reset" className={buttonSecondary}>
                    Clear record mapping
                  </button>
                </Form>
              </div>
              <p className="mt-2 text-[13px] text-slate-500">
                The cron syncs hourly. Tables: {airtable.tables.join(", ")}, each with a Local ID column that must not be
                deleted.
              </p>
            </>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">Accelevents</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            One-way push of the published programme to an Accelevents event. Best effort: dry run first, and read the log.
          </p>

          <Form method="post" className="mt-3 space-y-3">
            <input type="hidden" name="intent" value="accel-save" />
            <Field label="API key" name="apiKey" help={accel.config.apiKey ? "A key is stored. Leave blank to keep it." : "From the Accelevents dashboard, under API access."}>
              <input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={accel.config.apiKey ? "Stored" : ""} className={inputClass} />
            </Field>
            <Field label="Accelevents event id" name="accelEventId">
              <input id="accelEventId" name="accelEventId" defaultValue={accel.config.eventId} className={inputClass} />
            </Field>
            <Field label="API base URL" name="baseUrl" help="Change only if your account uses a different host.">
              <input id="baseUrl" name="baseUrl" defaultValue={accel.config.baseUrl || accel.defaultBase} className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-900">
              <input type="checkbox" name="enabled" defaultChecked={accel.config.enabled} className="accent-accent" />
              Push hourly
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={buttonPrimary}>
                Save
              </button>
              <Link to="?dryrun=1" className={buttonSecondary}>
                Dry run
              </Link>
              <button type="submit" name="intent" value="accel-push" className={buttonSecondary} formNoValidate>
                Push now
              </button>
            </div>
          </Form>

          {accel.dryRun ? (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <h3 className="text-sm font-semibold text-slate-900">Dry run</h3>
              <p className="mt-0.5 text-[13px] text-slate-500">
                {accel.dryRun.summary.sessions} sessions and {accel.dryRun.summary.speakers} speakers would be sent to{" "}
                {accel.dryRun.endpoints.sessions} and {accel.dryRun.endpoints.speakers}.
                {accel.dryRun.configured ? "" : " No credentials are set, so this is the payload only."}
              </p>
              <textarea
                readOnly
                rows={12}
                aria-label="Dry run payload"
                value={JSON.stringify(accel.dryRun.payload, null, 2)}
                className={`${textareaClass} mt-2 font-mono text-xs`}
              />
            </div>
          ) : null}

          <h3 className="mt-4 text-sm font-semibold text-slate-900">Push log</h3>
          {accel.log.length === 0 ? (
            <p className="mt-1 text-[13px] text-slate-500">Nothing pushed yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100">
              {accel.log.map((entry) => (
                <li key={entry.at} className="py-2 text-[13px]">
                  <p className={entry.ok ? "text-slate-900" : "text-rose-600"}>
                    {entry.ok ? "Pushed" : "Failed"}, {entry.sessions} sessions, {entry.speakers} speakers
                  </p>
                  <p className="text-slate-500">
                    {formatDateTime(new Date(entry.at), event.timezone)}, {entry.message}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-4 text-sm font-semibold text-slate-900">Field mapping</h3>
          <table className="mt-1 w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th scope="col" className="py-2 font-medium">OpenSession</th>
                <th scope="col" className="py-2 font-medium">Accelevents</th>
                <th scope="col" className="py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {accel.fieldMap.map((row) => (
                <tr key={row.ours} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 font-mono text-xs text-slate-900">{row.ours}</td>
                  <td className="py-1.5 font-mono text-xs text-slate-900">{row.theirs}</td>
                  <td className="py-1.5 text-slate-500">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
