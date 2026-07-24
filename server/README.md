# drawdb cloud-sync server

A tiny, single-user backend for a personal cloud-sync fork of
[drawdb](https://github.com/drawdb-io/drawdb). It stores diagrams (and a rolling
history of revisions) in Postgres and exposes a small JSON API under `/api`. A
built frontend can be served from the same origin, so the whole thing runs as
one container plus a database.

- One password, one account. No registration, no email, no multi-user.
- Fastify (v5) + `pg`. No ORM, no TypeScript, no build step.
- Optimistic concurrency with version numbers and a conflict payload.
- Soft-delete with a 30-day grace period; up to 30 revisions kept per diagram.

## Environment variables

| Variable        | Default                                          | Notes |
| --------------- | ------------------------------------------------ | ----- |
| `AUTH_PASSWORD` | — (**required**)                                 | The single login password. The server exits if this is empty/unset. |
| `DATABASE_URL`  | `postgres://drawdb:drawdb@localhost:5432/drawdb` | Postgres connection string. |
| `PORT`          | `3001`                                           | Listen port. |
| `HOST`          | `0.0.0.0`                                         | Listen address. |
| `STATIC_DIR`    | `../dist` (relative to `server/index.js`)        | If the directory exists it is served with an SPA fallback; otherwise the server runs API-only. |
| `COOKIE_SECURE` | `auto`                                            | `auto` sets the `Secure` cookie flag when the request is HTTPS (directly or via `x-forwarded-proto`). `true`/`false` force it. |
| `TRUST_PROXY`   | `true`                                            | Sets Fastify `trustProxy`. Set to `false` to disable. |

## Quickstart (docker compose)

From the repository root:

```sh
# Create a .env next to compose.cloud.yml:
#   AUTH_PASSWORD=choose-a-strong-password
#   POSTGRES_PASSWORD=another-strong-password   # optional, defaults to "drawdb"
docker compose -f compose.cloud.yml up -d --build
```

The app is then reachable at http://localhost:8080 (host `8080` -> container
`3001`). Postgres is internal only; it is not published to the host.

## Backup & restore

```sh
# Backup
docker compose -f compose.cloud.yml exec db pg_dump -U drawdb drawdb > backup.sql

# Restore (into a running, empty db)
docker compose -f compose.cloud.yml exec -T db psql -U drawdb drawdb < backup.sql
```

## API examples

The API uses a session cookie (`drawdb_session`, HttpOnly). With `curl`, use a
cookie jar so the cookie set by login is reused by later calls.

```sh
BASE=http://localhost:8080

# 1. Log in (stores the session cookie in cookies.txt)
curl -sS -c cookies.txt -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"password":"choose-a-strong-password"}'
# -> {"ok":true}

# 2. List diagrams
curl -sS -b cookies.txt "$BASE/api/diagrams"
# -> [{"diagramId":"...","name":"...","database":"generic","lastModified":"...","sizeBytes":123}]

# 3. Create / update a diagram (first PUT to a new id creates it with version 1)
ID=$(cat /proc/sys/kernel/random/uuid)
curl -sS -b cookies.txt -X PUT "$BASE/api/diagrams/$ID" \
  -H 'Content-Type: application/json' \
  -d '{"name":"My schema","database":"postgres","content":{"tables":[]},"baseVersion":null}'
# -> {"version":1,"created":true}

# 4. Update with the version you last saw (baseVersion must match the server)
curl -sS -b cookies.txt -X PUT "$BASE/api/diagrams/$ID" \
  -H 'Content-Type: application/json' \
  -d '{"name":"My schema","database":"postgres","content":{"tables":[{"name":"users"}]},"baseVersion":1}'
# -> {"version":2}

# 5. Conflict: send a stale baseVersion -> 409 with the server's current row
curl -sS -b cookies.txt -X PUT "$BASE/api/diagrams/$ID" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Stale edit","database":"postgres","content":{"tables":[]},"baseVersion":1}'
# -> HTTP 409 {"error":"conflict","diagramId":"...","version":2,"content":{...}, ...}
#    Re-PUT with "baseVersion":2 (or "force":true) to overwrite.
```

Other endpoints: `POST /api/auth/logout`, `GET /api/auth/me`,
`GET /api/diagrams/:id`, `DELETE /api/diagrams/:id` (soft delete, idempotent),
`GET /api/diagrams/:id/revisions`, and
`GET /api/diagrams/:id/revisions/:version`.

## Running without Docker

```sh
cd server
npm install
AUTH_PASSWORD=dev DATABASE_URL=postgres://drawdb:drawdb@localhost:5432/drawdb npm start
```

The schema is applied idempotently on every boot, so pointing at a fresh
Postgres database is all that is required.
