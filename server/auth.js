import crypto from "node:crypto";
import { pool } from "./db.js";

const COOKIE_NAME = "drawdb_session";
const SESSION_TTL_DAYS = 30;
const SLIDING_REFRESH_MS = 60 * 60 * 1000; // refresh expiry if last used > 1h ago

// AUTH_PASSWORD is validated (non-empty) in index.js before the server boots.
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "";
const COOKIE_SECURE = process.env.COOKIE_SECURE || "auto";
// Optional API key for non-browser clients (the MCP server). Grants the same
// diagram access as a session, via `Authorization: Bearer <key>` — so the
// account password never has to leave the browser login flow. Unset = bearer
// auth disabled entirely.
const MCP_KEY = process.env.MCP_KEY || "";

// ---- helpers ---------------------------------------------------------------

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function sha256Buf(input) {
  return crypto.createHash("sha256").update(input).digest();
}

function firstHeader(value) {
  return (Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
}

// Origins this deployment may legitimately be reached on: the Host header,
// x-forwarded-host (reverse proxies that rewrite Host), and an optional
// ALLOWED_ORIGIN env override.
function ownOrigins(request) {
  const xfp = firstHeader(request.headers["x-forwarded-proto"]);
  const proto = xfp || request.protocol || "http";
  const origins = new Set();
  const host = request.headers.host || "";
  if (host) {
    origins.add(`${proto}://${host}`);
    origins.add(`${proto === "https" ? "http" : "https"}://${host}`);
  }
  const xfh = firstHeader(request.headers["x-forwarded-host"]);
  if (xfh) origins.add(`${proto}://${xfh}`);
  if (process.env.ALLOWED_ORIGIN) origins.add(process.env.ALLOWED_ORIGIN);
  return origins;
}

function shouldBeSecure(request) {
  if (COOKIE_SECURE === "true") return true;
  if (COOKIE_SECURE === "false") return false;
  // "auto"
  const forwarded = firstHeader(request.headers["x-forwarded-proto"]);
  return forwarded === "https" || request.protocol === "https";
}

function sessionCookieOptions(request) {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60, // seconds
    secure: shouldBeSecure(request),
  };
}

// ---- in-memory login rate limiting ----------------------------------------

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_FAILURES = 10;
// Per-IP is bypassable when an attacker can vary request.ip (or spoof
// X-Forwarded-For behind a misconfigured proxy), so a global ceiling backs it
// up. A single legitimate user never comes close to it.
const RATE_MAX_GLOBAL_FAILURES = 50;
const failuresByIp = new Map(); // ip -> array<timestamp ms>
let globalFailures = []; // timestamps ms

function pruneFailures(ip, now) {
  const list = failuresByIp.get(ip);
  if (!list) return [];
  const kept = list.filter((t) => now - t < RATE_WINDOW_MS);
  if (kept.length > 0) failuresByIp.set(ip, kept);
  else failuresByIp.delete(ip);
  return kept;
}

// Buckets are namespaced per mechanism ("pw:<ip>" / "mcp:<ip>") so failed
// password guesses can't throttle a caller's valid API key, and vice versa.
function isRateLimited(bucket) {
  const now = Date.now();
  globalFailures = globalFailures.filter((t) => now - t < RATE_WINDOW_MS);
  // The global ceiling tightens the per-bucket allowance instead of denying
  // outright: strangers' failures must never lock out a caller whose own
  // record is clean (that would be a trivial unauthenticated DoS).
  const max =
    globalFailures.length >= RATE_MAX_GLOBAL_FAILURES ? 1 : RATE_MAX_FAILURES;
  return pruneFailures(bucket, now).length >= max;
}

function recordFailure(bucket) {
  const now = Date.now();
  const kept = pruneFailures(bucket, now);
  kept.push(now);
  failuresByIp.set(bucket, kept);
  globalFailures.push(now);
}

function clearFailures(bucket) {
  const list = failuresByIp.get(bucket);
  failuresByIp.delete(bucket);
  // A success also un-poisons this bucket's contribution to the global count,
  // so one legitimate user can't stay collateral-damaged by their own typos.
  if (list?.length) {
    const drop = new Set(list);
    globalFailures = globalFailures.filter((t) => !drop.has(t));
  }
}

// The map only self-prunes on repeat visits from the same IP; sweep it so
// one-shot IPs don't accumulate forever.
function sweepFailures() {
  const now = Date.now();
  globalFailures = globalFailures.filter((t) => now - t < RATE_WINDOW_MS);
  for (const [ip, list] of failuresByIp) {
    if (list.length === 0 || now - list[list.length - 1] >= RATE_WINDOW_MS) {
      failuresByIp.delete(ip);
    }
  }
}

// ---- session lookup (preHandler for protected routes) ----------------------

// Validates an `Authorization: Bearer <key>` header against the UI-managed key
// in mcp_keys and, if set, the MCP_KEY env var. Also used by the /mcp endpoint.
// Returns {ok:true} or {ok:false, status: 401|429}.
export async function verifyMcpBearer(request) {
  const authHeader = request.headers.authorization;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401 };
  }
  // Evaluate throttling up front but apply it only when the credential turns
  // out to be wrong: rejecting a *valid* key because someone else guessed
  // badly would hand any anonymous client a denial-of-service lever.
  const bucket = `mcp:${request.ip}`;
  const limited = isRateLimited(bucket);
  const key = authHeader.slice("Bearer ".length);
  const keyHash = sha256Hex(key);

  if (MCP_KEY && crypto.timingSafeEqual(sha256Buf(key), sha256Buf(MCP_KEY))) {
    clearFailures(bucket);
    return { ok: true }; // env-configured key (compose/simple deployments)
  }

  const { rows } = await pool.query(
    "SELECT key_hash, last_used_at FROM mcp_keys WHERE id = 1",
  );
  if (
    rows.length === 1 &&
    crypto.timingSafeEqual(
      Buffer.from(keyHash, "hex"),
      Buffer.from(rows[0].key_hash, "hex"),
    )
  ) {
    const lastUsed = rows[0].last_used_at
      ? new Date(rows[0].last_used_at).getTime()
      : 0;
    if (Date.now() - lastUsed > SLIDING_REFRESH_MS) {
      pool
        .query("UPDATE mcp_keys SET last_used_at = now() WHERE id = 1")
        .catch((err) => request.log.warn({ err }, "mcp key touch failed"));
    }
    clearFailures(bucket);
    return { ok: true }; // authenticated via UI-managed MCP key
  }

  recordFailure(bucket);
  return { ok: false, status: limited ? 429 : 401 };
}

export async function requireSession(request, reply) {
  // API-key path: presence of an Authorization header selects it explicitly,
  // so a bad key never falls through to the cookie flow.
  const authHeader = request.headers.authorization;
  if (typeof authHeader === "string" && authHeader.length > 0) {
    const v = await verifyMcpBearer(request);
    if (!v.ok) {
      return reply
        .code(v.status)
        .send({ error: v.status === 429 ? "too_many_attempts" : "unauthorized" });
    }
    return;
  }

  return checkCookieSession(request, reply);
}

// Cookie-session-only guard: used for credential management (the MCP key must
// not be able to manage itself, or a leaked key could survive rotation).
export async function requireCookieSession(request, reply) {
  return checkCookieSession(request, reply);
}

async function checkCookieSession(request, reply) {
  const token = request.cookies?.[COOKIE_NAME];
  if (!token) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const hash = sha256Hex(token);
  const { rows } = await pool.query(
    "SELECT last_used_at FROM sessions WHERE token_hash = $1 AND expires_at > now()",
    [hash],
  );
  if (rows.length === 0) {
    return reply.code(401).send({ error: "unauthorized" });
  }

  // Sliding expiry: bump last_used_at / expires_at at most once per hour.
  // The cookie must slide too, or the browser drops it 30 days after login
  // regardless of activity. DB update is fire-and-forget.
  const lastUsed = new Date(rows[0].last_used_at).getTime();
  if (Date.now() - lastUsed > SLIDING_REFRESH_MS) {
    reply.setCookie(COOKIE_NAME, token, sessionCookieOptions(request));
    pool
      .query(
        "UPDATE sessions SET last_used_at = now(), expires_at = now() + interval '30 days' WHERE token_hash = $1",
        [hash],
      )
      .catch((err) => request.log.warn({ err }, "sliding session refresh failed"));
  }
}

// ---- MCP key management (cookie session only) --------------------------------

async function getMcpKeyStatus() {
  const { rows } = await pool.query(
    "SELECT created_at, last_used_at FROM mcp_keys WHERE id = 1",
  );
  if (rows.length === 0) return { exists: false, envKeyConfigured: !!MCP_KEY };
  return {
    exists: true,
    envKeyConfigured: !!MCP_KEY,
    createdAt: rows[0].created_at,
    lastUsedAt: rows[0].last_used_at,
  };
}

export function registerMcpKeyRoutes(app) {
  app.register(async (scope) => {
    scope.addHook("preHandler", requireCookieSession);

    scope.get("/api/mcp-key", async () => getMcpKeyStatus());

    // Generates (or replaces) the key. The plaintext is returned exactly once;
    // only its sha256 is stored.
    scope.post("/api/mcp-key", async () => {
      const key = crypto.randomBytes(32).toString("base64url");
      await pool.query(
        `INSERT INTO mcp_keys (id, key_hash, created_at, last_used_at)
         VALUES (1, $1, now(), NULL)
         ON CONFLICT (id) DO UPDATE
           SET key_hash = $1, created_at = now(), last_used_at = NULL`,
        [sha256Hex(key)],
      );
      return { key };
    });

    scope.delete("/api/mcp-key", async () => {
      await pool.query("DELETE FROM mcp_keys WHERE id = 1");
      return { ok: true };
    });
  });
}

// ---- security hooks (CSRF + content-type) ----------------------------------

export function registerSecurityHooks(app) {
  app.addHook("onRequest", async (request, reply) => {
    const method = request.method;
    if (method !== "POST" && method !== "PUT" && method !== "DELETE") return;

    // CSRF: modern browsers state the relationship directly; trust that first
    // (it also keeps dev proxies that rewrite Host working).
    const site = request.headers["sec-fetch-site"];
    if (site === "same-origin" || site === "none") {
      // fine
    } else if (site === "cross-site" || site === "same-site") {
      return reply.code(403).send({ error: "forbidden" });
    } else {
      // No Sec-Fetch-Site (older browser or non-browser client): fall back to
      // comparing Origin, when present, against the origins we serve.
      const origin = request.headers.origin;
      if (origin && !ownOrigins(request).has(origin)) {
        return reply.code(403).send({ error: "forbidden" });
      }
    }

    // Only accept JSON bodies. DELETE typically has no body, so only enforce
    // when a body is actually present.
    const hasBody =
      Number(request.headers["content-length"] || 0) > 0 ||
      request.headers["transfer-encoding"] != null;
    if (hasBody) {
      const ct = String(request.headers["content-type"] || "").toLowerCase();
      if (!ct.startsWith("application/json")) {
        return reply.code(415).send({ error: "unsupported_media_type" });
      }
    }
  });
}

// ---- routes ----------------------------------------------------------------

async function login(request, reply) {
  // Throttling is decided up front but only applied to a WRONG password —
  // the correct one always gets through, so guessing can't lock the owner out.
  const bucket = `pw:${request.ip}`;
  const limited = isRateLimited(bucket);

  const body = request.body && typeof request.body === "object" ? request.body : {};
  const password = typeof body.password === "string" ? body.password : "";

  // Constant-time compare over fixed-length sha256 digests.
  const ok = crypto.timingSafeEqual(sha256Buf(password), sha256Buf(AUTH_PASSWORD));
  if (!ok) {
    recordFailure(bucket);
    return limited
      ? reply.code(429).send({ error: "too_many_attempts" })
      : reply.code(401).send({ error: "invalid_password" });
  }
  clearFailures(bucket);

  const token = crypto.randomBytes(32).toString("base64url");
  const hash = sha256Hex(token);
  await pool.query(
    "INSERT INTO sessions (token_hash, expires_at) VALUES ($1, now() + interval '30 days')",
    [hash],
  );
  reply.setCookie(COOKIE_NAME, token, sessionCookieOptions(request));
  return { ok: true };
}

async function logout(request, reply) {
  const token = request.cookies?.[COOKIE_NAME];
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256Hex(token)]);
  }
  reply.clearCookie(COOKIE_NAME, { path: "/" });
  return { ok: true };
}

async function me(request, reply) {
  const token = request.cookies?.[COOKIE_NAME];
  if (!token) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const { rows } = await pool.query(
    "SELECT 1 FROM sessions WHERE token_hash = $1 AND expires_at > now()",
    [sha256Hex(token)],
  );
  if (rows.length === 0) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  return { loggedIn: true };
}

export function registerAuthRoutes(app) {
  app.post("/api/auth/login", login);
  app.post("/api/auth/logout", logout);
  app.get("/api/auth/me", me);
  // Unauthenticated liveness/readiness probe (also checks DB connectivity).
  app.get("/api/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });
}

// ---- background cleanup ----------------------------------------------------

export async function cleanupOnce(app) {
  try {
    await pool.query("DELETE FROM sessions WHERE expires_at < now()");
    await pool.query(
      "DELETE FROM diagrams WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'",
    );
  } catch (err) {
    app.log.warn({ err }, "periodic cleanup failed");
  }
}

export function startSessionCleanup(app) {
  cleanupOnce(app);
  const timer = setInterval(() => cleanupOnce(app), 24 * 60 * 60 * 1000);
  timer.unref();
  const sweepTimer = setInterval(sweepFailures, RATE_WINDOW_MS);
  sweepTimer.unref();
  return timer;
}
