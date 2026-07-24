// http.js — Streamable HTTP handling for the MCP server, used by the backend's
// /mcp endpoint (server/mcp-http.js). Lives in this package so every
// @modelcontextprotocol/sdk import resolves against mcp/node_modules.
//
// Stateless mode: each POST gets a fresh McpServer + transport (no session ids,
// plain JSON responses). That fits tool-only usage and survives pod restarts.

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./server.js";

export async function handleMcpHttpRequest({ client, editorBase, req, res, body }) {
  const server = buildMcpServer(client, { editorBase });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
