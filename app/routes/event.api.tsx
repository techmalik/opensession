// Settings > API. Tokens are shown once, at creation, and stored only as a
// SHA-256 hash: there is no screen anywhere that can show an existing token again,
// because the app does not have it.

import { Form, Link } from "react-router";
import { and, desc, eq } from "drizzle-orm";
import type { Route } from "./+types/event.api";
import { appBaseUrl, getDb } from "../lib/db.server";
import { requireOrganizer } from "../lib/session.server";
import { hashToken, newToken } from "../lib/api.server";
import { formatDateTime } from "../lib/format";
import { apiTokens, events } from "../../database/schema";
import {
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Notice,
  PageHeader,
  SubNav,
  buttonDanger,
  buttonPrimary,
  inputClass,
  textareaClass,
} from "../components/ui";

export function meta(): Route.MetaDescriptors {
  return [{ title: "API tokens" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireOrganizer(request);
  const db = getDb();
  const event = await db
    .select({ id: events.id, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, Number(params.eventId)))
    .get();
  if (!event) throw new Response("Event not found", { status: 404 });

  // Your own keys, not the installation's. Anyone can sign up as an organizer, and
  // a stranger being able to list and revoke other people's integrations is an
  // outage they can cause on demand. Admins keep the full view.
  const columns = {
    id: apiTokens.id,
    name: apiTokens.name,
    createdAt: apiTokens.createdAt,
    lastUsedAt: apiTokens.lastUsedAt,
  };
  const isAdmin = user.role === "admin";
  const query = db.select(columns).from(apiTokens);
  const tokens = await (isAdmin ? query : query.where(eq(apiTokens.createdBy, user.id)))
    .orderBy(desc(apiTokens.createdAt))
    .all();

  return { event, tokens, baseUrl: appBaseUrl(), isAdmin };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireOrganizer(request);
  const db = getDb();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return { error: "Name the token after whatever will use it.", notice: null, token: null };
    const token = newToken();
    // createdBy is what scopes the token: both /api/v1 and /mcp filter every read
    // and write through this organizer's event access, so a key can never reach
    // further than the person who minted it.
    await db
      .insert(apiTokens)
      .values({ name, tokenHash: await hashToken(token), createdBy: user.id, createdAt: new Date() });
    return { error: null, notice: null, token };
  }

  if (intent === "revoke") {
    const id = Number(form.get("tokenId") ?? 0);
    const scoped = user.role === "admin" ? eq(apiTokens.id, id) : and(eq(apiTokens.id, id), eq(apiTokens.createdBy, user.id));
    const existing = await db.select({ id: apiTokens.id }).from(apiTokens).where(scoped).get();
    if (!existing) return { error: "That token is not yours to revoke.", notice: null, token: null };
    await db.delete(apiTokens).where(eq(apiTokens.id, existing.id));
    return { error: null, notice: "Token revoked. Any client using it now gets a 401.", token: null };
  }

  return { error: null, notice: null, token: null };
}

export default function ApiTokensScreen({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, tokens, baseUrl, isAdmin } = loaderData;
  const base = `/admin/${params.eventId}`;
  const created = actionData?.token ?? null;

  return (
    <>
      <PageHeader
        title="API"
        description={`Tokens for the public API and the MCP server. A token reaches exactly the events the person who created it can open, on /api/v1 and over MCP alike. ${
          isAdmin ? "As an admin you see every token on this installation." : "You see the tokens you created."
        }`}
      />
      <SubNav
        items={[
          { to: `${base}/settings`, label: "Event" },
          { to: `${base}/settings/taxonomy`, label: "Tracks and formats" },
          { to: `${base}/settings/integrations`, label: "Integrations" },
          { to: `${base}/settings/api`, label: "API" },
        ]}
        current={`${base}/settings/api`}
      />

      {actionData?.error ? <ErrorNotice>{actionData.error}</ErrorNotice> : null}
      {actionData?.notice ? <Notice>{actionData.notice}</Notice> : null}

      {created ? (
        <Card className="mb-4 border-accent p-4">
          <h2 className="text-sm font-semibold text-slate-900">Copy this token now</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">
            This is the only time it is shown. Only its hash is stored, so it cannot be recovered, only replaced.
          </p>
          <textarea readOnly rows={2} value={created} aria-label="New token" className={`${textareaClass} mt-2 font-mono text-xs`} />
          <p className="mt-2 text-[13px] font-medium text-slate-900">Try it:</p>
          <textarea
            readOnly
            rows={2}
            aria-label="Example request"
            value={`curl -H "x-access-token: ${created}" ${baseUrl}/api/v1/events`}
            className={`${textareaClass} mt-1 font-mono text-xs`}
          />
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px] [&>*]:min-w-0">
        <Card>
          {tokens.length === 0 ? (
            <EmptyState message="No tokens yet. Create one to call the API." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th scope="col" className="px-4 py-2 font-medium">Name</th>
                    <th scope="col" className="px-4 py-2 font-medium">Created</th>
                    <th scope="col" className="px-4 py-2 font-medium">Last used</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.id} className="border-b border-slate-100 last:border-0">
                      <td className="h-10 px-4 font-medium text-slate-900">{token.name}</td>
                      <td className="px-4 text-slate-500">{formatDateTime(token.createdAt, event.timezone)}</td>
                      <td className="px-4 text-slate-500">
                        {token.lastUsedAt ? formatDateTime(token.lastUsedAt, event.timezone) : "Never"}
                      </td>
                      <td className="px-4 text-right">
                        <Form method="post">
                          <input type="hidden" name="tokenId" value={token.id} />
                          <button type="submit" name="intent" value="revoke" className="text-[13px] font-medium text-slate-500 hover:text-rose-600">
                            Revoke
                          </button>
                        </Form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-900">New token</h2>
          <Form method="post" className="mt-3 space-y-3">
            <input type="hidden" name="intent" value="create" />
            <Field label="Name" name="name" help="What will use it: a script, a website, a partner.">
              <input id="name" name="name" placeholder="Website agenda feed" className={inputClass} required />
            </Field>
            <button type="submit" className={buttonPrimary}>
              Create token
            </button>
          </Form>
          <p className="mt-3 text-[13px] text-slate-500">
            The endpoint reference with worked examples is at{" "}
            <Link to="/docs/api" className="font-medium text-accent hover:underline">
              /docs/api
            </Link>
            .
          </p>
        </Card>
      </div>
    </>
  );
}
