// POST /mcp: the MCP streamable HTTP endpoint. A resource route with no component,
// so none of this reaches the client bundle. All of the protocol lives in
// app/lib/mcp.server.ts; this file is the registration and nothing else.

import type { Route } from "./+types/mcp";
import { handleMcpPost, mcpDescription, mcpPreflight } from "../lib/mcp.server";

export async function loader({ request }: Route.LoaderArgs) {
  if (request.method === "OPTIONS") return mcpPreflight();
  return mcpDescription(new URL(request.url).origin);
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method === "OPTIONS") return mcpPreflight();
  if (request.method === "DELETE") return new Response(null, { status: 204 });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "This endpoint accepts POST." }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return handleMcpPost(request);
}
