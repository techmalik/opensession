// The MCP streamable HTTP transport, hand-rolled.
//
// The official TypeScript SDK assumes a Node server (node:http, EventSource,
// process-level session storage) and pulls a dependency tree a Worker does not need
// for three methods. This module speaks the subset that matters: JSON-RPC 2.0 over a
// single POST, initialize / tools/list / tools/call / ping, one JSON response per
// request, no server-initiated stream and therefore no session id to keep.
//
// Auth is the existing API token, so an agent and a script hold the same credential.

import { eq } from "drizzle-orm";
import { getDb } from "./db.server";
import { hashToken } from "./api.server";
import { scopeForToken } from "./token-scope.server";
import { ToolError, TOOLS, TOOLS_BY_NAME, type McpContext } from "./mcp-tools.server";
import { apiTokens } from "../../database/schema";

export const SERVER_NAME = "opensession";
export const SERVER_VERSION = "1.0.0";

/** Newest first. An unknown version is answered with the newest we speak, which is
 *  what the spec asks a server to do. */
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const PROTOCOL_VERSION = SUPPORTED_PROTOCOLS[0];

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;
const RPC_UNAUTHORIZED = -32001;

type RpcId = string | number | null;

interface RpcMessage {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: RpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, x-access-token, authorization, mcp-protocol-version, mcp-session-id",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
    },
  });
}

const TOKEN_HELP =
  "Authenticate with an OpenSession API token. Send it as an x-access-token header or as Authorization: Bearer <token>. Create one in the organizer admin under Settings, API; it is shown once.";

/** x-access-token, or an Authorization: Bearer for clients that only speak OAuth
 *  shaped headers. */
function presentedToken(request: Request): string | null {
  const header = request.headers.get("x-access-token")?.trim();
  if (header) return header;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match ? match[1].trim() : null;
}

async function authenticate(request: Request): Promise<McpContext | string> {
  const token = presentedToken(request);
  if (!token) return TOKEN_HELP;

  const row = await getDb()
    .select({ id: apiTokens.id, name: apiTokens.name })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, await hashToken(token)))
    .get();
  if (!row) return `That access token is not valid. ${TOKEN_HELP}`;

  // Best effort, exactly as the REST layer does it: a failed write here must not
  // fail the call.
  try {
    await getDb().update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  } catch {
    /* ignore */
  }

  return {
    token,
    origin: new URL(request.url).origin,
    scope: await scopeForToken(row.id, row.name),
  };
}

function toolDescriptors() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, openWorldHint: false },
  }));
}

async function callTool(params: Record<string, unknown>, context: McpContext) {
  const name = String(params.name ?? "");
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    throw new RpcFailure(RPC_INVALID_PARAMS, `Unknown tool "${name}". Call tools/list for the ${TOOLS.length} available.`);
  }
  const input = (params.arguments ?? {}) as Record<string, unknown>;

  try {
    const result = await tool.run(input, context);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: false,
    };
  } catch (error) {
    // A tool that fails for a reason the agent can fix comes back as tool content,
    // not a transport error, so the agent can read it and try again. Anything else
    // is ours: the detail goes to the logs, and the client gets a fixed sentence.
    // A D1 error text names tables and constraints, which is a map for the next try.
    if (error instanceof ToolError) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    console.error(`mcp tool ${name} failed`, error);
    return { content: [{ type: "text", text: `${name} failed. The server logged the details.` }], isError: true };
  }
}

class RpcFailure extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

async function dispatch(message: RpcMessage, context: McpContext) {
  const id = message.id ?? null;
  const params = message.params ?? {};

  switch (message.method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: "OpenSession", version: SERVER_VERSION },
        instructions:
          "Conference program management. Call list_events first: every other tool takes the eventId it returns. Decision tools change status only; decision emails stay an explicit step in the organizer's Communications screen.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: toolDescriptors() });
    case "tools/call":
      return rpcResult(id, await callTool(params, context));
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, RPC_METHOD_NOT_FOUND, `This server does not implement "${message.method}".`);
  }
}

async function handleMessage(message: RpcMessage, context: McpContext) {
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message.id ?? null, RPC_INVALID_REQUEST, 'Every message needs jsonrpc "2.0" and a method.');
  }
  try {
    return await dispatch(message, context);
  } catch (error) {
    if (error instanceof RpcFailure) return rpcError(message.id ?? null, error.code, error.message);
    console.error(`mcp ${message.method} failed`, error);
    return rpcError(message.id ?? null, RPC_INTERNAL_ERROR, "Internal error. The server logged the details.");
  }
}

/** A JSON-RPC message this server will look at. Anything larger is refused before a
 *  byte is buffered: parsing is the expensive part, and an endpoint that parses
 *  first is an endpoint anyone can make work. */
const MAX_BODY_BYTES = 1024 * 1024;

/** Reads the body with a hard ceiling, streaming so an oversized request is dropped
 *  rather than held. Null means "too large". */
async function readCappedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/** POST /mcp. Everything the transport does starts here. */
export async function handleMcpPost(request: Request): Promise<Response> {
  // Authenticate before the body is read, not after it is parsed. Otherwise an
  // unauthenticated client can spend this Worker's memory and CPU on JSON it was
  // never going to be allowed to send.
  const context = await authenticate(request);
  if (typeof context === "string") {
    return jsonResponse(rpcError(null, RPC_UNAUTHORIZED, context), 401);
  }

  const text = await readCappedBody(request);
  if (text === null) {
    return jsonResponse(rpcError(null, RPC_INVALID_REQUEST, "That request body is larger than 1 MB."), 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return jsonResponse(rpcError(null, RPC_PARSE_ERROR, "The request body is not valid JSON."), 400);
  }

  const batch = Array.isArray(payload) ? (payload as RpcMessage[]) : [payload as RpcMessage];
  if (batch.length === 0) {
    return jsonResponse(rpcError(null, RPC_INVALID_REQUEST, "Send at least one JSON-RPC message."), 400);
  }

  // Notifications carry no id and expect no body back.
  const answerable = batch.filter((message) => message?.id !== undefined && message?.id !== null);
  if (answerable.length === 0) return new Response(null, { status: 202 });

  const results = [];
  for (const message of answerable) results.push(await handleMessage(message, context));
  return jsonResponse(results.length === 1 ? results[0] : results);
}

/** GET /mcp. There is no server-initiated stream, so instead of a bare 405 this
 *  hands back what a person poking at the URL actually needs. */
export function mcpDescription(origin: string): Response {
  return jsonResponse({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    transport: "streamable-http",
    endpoint: `${origin}/mcp`,
    protocolVersions: SUPPORTED_PROTOCOLS,
    auth: TOKEN_HELP,
    tools: TOOLS.map((tool) => tool.name),
    docs: `${origin}/docs/api`,
  });
}

export function mcpPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, x-access-token, authorization, mcp-protocol-version, mcp-session-id",
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}
