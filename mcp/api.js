// api.js — thin HTTP client for the drawdb cloud REST API using global fetch.
// Handles single-password login, session-cookie management, transparent
// re-login on expiry, and structured errors (409 conflict is surfaced, not
// swallowed, so optimistic-concurrency retries can see the server's version).

const SESSION_COOKIE = "drawdb_session";

// Node's fetch exposes getSetCookie() (an array); fall back to the combined
// header for older runtimes.
function readSetCookie(res) {
  if (typeof res.headers.getSetCookie === "function") {
    const arr = res.headers.getSetCookie();
    if (arr && arr.length > 0) return arr.join("\n");
  }
  return res.headers.get("set-cookie") || "";
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export class DrawdbClient {
  constructor({ baseUrl, password, apiKey }) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.password = password;
    this.apiKey = apiKey || null;
    this.cookie = null;
  }

  // Cheap authenticated call to fail fast on a bad key at startup.
  async verifyKey() {
    const res = await this._send("GET", "/api/diagrams");
    if (res.status === 401) {
      throw new ApiError(
        "Authentication failed: the DRAWDB_MCP_KEY is not accepted by the server. Check the key and that the deployment sets MCP_KEY.",
        401,
      );
    }
    if (res.status === 429) {
      throw new ApiError(
        "Rate-limited by the server (too many recent auth failures). Wait ~15 minutes and retry.",
        429,
      );
    }
    if (!res.ok) {
      throw new ApiError(`Key check failed with HTTP ${res.status}.`, res.status);
    }
  }

  // Authenticates and captures the session cookie. Throws a clear ApiError on
  // wrong password (401) or rate limiting (429).
  async login() {
    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: this.password }),
      });
    } catch (err) {
      throw new ApiError(
        `Cannot reach drawdb at ${this.baseUrl} (${err.message}). Check DRAWDB_URL and that the server is running.`,
        0,
      );
    }

    if (res.status === 401) {
      throw new ApiError(
        "Login failed: wrong password. Check the DRAWDB_PASSWORD environment variable.",
        401,
      );
    }
    if (res.status === 429) {
      throw new ApiError(
        "Login rate-limited by the server (too many recent attempts). Wait a few minutes and retry.",
        429,
      );
    }
    if (!res.ok) {
      throw new ApiError(`Login failed with HTTP ${res.status}.`, res.status);
    }

    const setCookie = readSetCookie(res);
    const match = new RegExp(`${SESSION_COOKIE}=([^;\\s]+)`).exec(setCookie);
    if (!match) {
      throw new ApiError(
        "Login succeeded but the server returned no session cookie.",
        res.status,
      );
    }
    this.cookie = `${SESSION_COOKIE}=${match[1]}`;
  }

  async _send(method, path, body) {
    const headers = {};
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    else if (this.cookie) headers.cookie = this.cookie;
    const init = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(`${this.baseUrl}${path}`, init);
  }

  // JSON in / JSON out. With an API key a 401 is terminal (the key is wrong);
  // with password auth we re-login once and retry. 409 is thrown as an
  // ApiError carrying `.data` (the conflict payload); other non-2xx throw with
  // the server's `error` field. 200-with-no-body returns null.
  async request(method, path, body) {
    if (!this.apiKey && !this.cookie) await this.login();

    let res = await this._send(method, path, body);
    if (res.status === 401) {
      if (this.apiKey) {
        throw new ApiError(
          "Authentication failed: the DRAWDB_MCP_KEY was rejected. Check the key and the server's MCP_KEY setting.",
          401,
        );
      }
      await this.login();
      res = await this._send(method, path, body);
    }

    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error || "conflict", 409, data);
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const detail = data && data.error ? data.error : `HTTP ${res.status}`;
      throw new ApiError(`${method} ${path} failed: ${detail}`, res.status, data);
    }

    if (res.status === 204) return null;
    return res.json().catch(() => null);
  }
}
