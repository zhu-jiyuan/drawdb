#!/usr/bin/env node
// drawdb-mcp — a stdio MCP server that lets AI assistants manage database
// diagrams stored in a self-hosted drawdb cloud backend via its REST API.
//
// Transport: stdio (JSON-RPC). All diagnostics go to stderr so stdout stays a
// clean protocol channel. Auth: DRAWDB_MCP_KEY (preferred) or DRAWDB_PASSWORD.
//
// The same six tools are also served over Streamable HTTP by the backend
// itself at {DRAWDB_URL}/mcp — see mcp/http.js and server/mcp-http.js.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DrawdbClient } from "./api.js";
import { buildMcpServer } from "./server.js";

const DRAWDB_URL = (process.env.DRAWDB_URL || "https://drawdb.mpga.me").replace(
  /\/+$/,
  "",
);
const DRAWDB_MCP_KEY = process.env.DRAWDB_MCP_KEY;
const DRAWDB_PASSWORD = process.env.DRAWDB_PASSWORD;

if (!DRAWDB_MCP_KEY && !DRAWDB_PASSWORD) {
  process.stderr.write(
    "drawdb-mcp: FATAL — set DRAWDB_MCP_KEY (preferred; generate it on the web UI)\n" +
      "or DRAWDB_PASSWORD (account password) and restart.\n",
  );
  process.exit(1);
}

const client = new DrawdbClient({
  baseUrl: DRAWDB_URL,
  password: DRAWDB_PASSWORD,
  apiKey: DRAWDB_MCP_KEY,
});

const server = buildMcpServer(client, { editorBase: DRAWDB_URL });

async function main() {
  // Validate credentials up front so a bad key/password fails fast and visibly.
  try {
    if (DRAWDB_MCP_KEY) await client.verifyKey();
    else await client.login();
  } catch (err) {
    process.stderr.write(`drawdb-mcp: ${err.message}\n`);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `drawdb-mcp: connected (stdio) to ${DRAWDB_URL}. 6 tools ready.\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`drawdb-mcp: fatal ${err?.stack || err}\n`);
  process.exit(1);
});
