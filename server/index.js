import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { pool, runSchema } from "./db.js";
import {
  registerAuthRoutes,
  registerSecurityHooks,
  startSessionCleanup,
} from "./auth.js";
import { registerDiagramRoutes } from "./diagrams.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- environment -----------------------------------------------------------

const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
if (!AUTH_PASSWORD || AUTH_PASSWORD.length === 0) {
  console.error(
    "FATAL: AUTH_PASSWORD environment variable is required and must not be empty.",
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
// Opt-in: trusting X-Forwarded-* headers with no proxy in front lets clients
// spoof request.ip and defeat the login rate limiter.
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

const app = Fastify({
  logger: true,
  trustProxy: TRUST_PROXY,
  bodyLimit: 16 * 1024 * 1024, // 16 MB
});

// ---- boot ------------------------------------------------------------------

async function main() {
  await runSchema();

  await app.register(cookie);
  registerSecurityHooks(app);
  registerAuthRoutes(app);
  registerDiagramRoutes(app);

  // Static SPA serving (optional). STATIC_DIR is resolved relative to this file.
  const staticDir = resolve(__dirname, process.env.STATIC_DIR || "../dist");
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      // SPA fallback: any non-/api GET that misses a file serves index.html.
      if (request.method === "GET" && !request.url.startsWith("/api")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
    app.log.info(`Serving static files from ${staticDir}`);
  } else {
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: "not_found" }),
    );
    app.log.info(`Static dir ${staticDir} not found; running in API-only mode.`);
  }

  startSessionCleanup(app);

  await app.listen({ port: PORT, host: HOST });
}

// ---- graceful shutdown -----------------------------------------------------

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`Received ${signal}, shutting down...`);
  try {
    await app.close();
  } catch (err) {
    app.log.error({ err }, "error closing fastify");
  }
  try {
    await pool.end();
  } catch (err) {
    app.log.error({ err }, "error closing pool");
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
