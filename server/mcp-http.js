// mcp-http.js — hosts the MCP server over Streamable HTTP at /mcp.
// Auth: the same Bearer MCP key as the REST API. Tool calls are executed by
// re-entering our own REST API over loopback with that key forwarded, so the
// HTTP and stdio transports share one code path and one auth model.

import { DrawdbClient } from "../mcp/api.js";
import { handleMcpHttpRequest } from "../mcp/http.js";
import { verifyMcpBearer } from "./auth.js";

function firstHeader(value) {
  return (Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
}

export function registerMcpHttp(app, { port }) {
  app.post("/mcp", async (request, reply) => {
    const v = await verifyMcpBearer(request);
    if (!v.ok) {
      return reply
        .code(v.status)
        .send({ error: v.status === 429 ? "too_many_attempts" : "unauthorized" });
    }

    const key = request.headers.authorization.slice("Bearer ".length);
    const proto =
      firstHeader(request.headers["x-forwarded-proto"]) || request.protocol || "http";
    const host =
      firstHeader(request.headers["x-forwarded-host"]) ||
      request.headers.host ||
      `localhost:${port}`;

    const client = new DrawdbClient({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: key,
    });

    // The transport writes directly to the raw response.
    reply.hijack();
    try {
      await handleMcpHttpRequest({
        client,
        editorBase: `${proto}://${host}`,
        req: request.raw,
        res: reply.raw,
        body: request.body,
      });
    } catch (err) {
      request.log.error({ err }, "mcp http request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "internal error" },
            id: null,
          }),
        );
      } else {
        reply.raw.end();
      }
    }
  });

  // Stateless endpoint: no SSE stream, no sessions to delete.
  const notAllowed = (_request, reply) =>
    reply.code(405).send({
      error: "method_not_allowed",
      note: "This MCP endpoint is stateless — POST JSON-RPC messages only.",
    });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
