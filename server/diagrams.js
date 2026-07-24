import crypto from "node:crypto";
import { pool } from "./db.js";
import { requireSession } from "./auth.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_NAME = "Untitled diagram";
const DEFAULT_DATABASE = "generic";
const MAX_NAME_LEN = 500;
const MAX_DATABASE_LEN = 64;
const KEEP_REVISIONS = 30;

function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function iso(value) {
  return new Date(value).toISOString();
}

// ---- read routes -----------------------------------------------------------

async function listDiagrams() {
  const { rows } = await pool.query(
    `SELECT id, name, "database", updated_at, size_bytes
       FROM diagrams
      WHERE deleted_at IS NULL
      ORDER BY updated_at DESC`,
  );
  return rows.map((r) => ({
    diagramId: r.id,
    name: r.name,
    database: r.database,
    lastModified: iso(r.updated_at),
    sizeBytes: r.size_bytes,
  }));
}

async function getDiagram(request, reply) {
  const { id } = request.params;
  if (!isUuid(id)) {
    return reply.code(404).send({ error: "not_found" });
  }
  const { rows } = await pool.query(
    `SELECT id, name, "database", content, version, updated_at
       FROM diagrams
      WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (rows.length === 0) {
    return reply.code(404).send({ error: "not_found" });
  }
  const r = rows[0];
  return {
    diagramId: r.id,
    name: r.name,
    database: r.database,
    lastModified: iso(r.updated_at),
    version: r.version,
    content: r.content,
  };
}

// ---- write route -----------------------------------------------------------

async function putDiagram(request, reply) {
  const { id } = request.params;
  if (!isUuid(id)) {
    return reply.code(400).send({ error: "invalid_id" });
  }

  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body
    : {};

  const content = body.content;
  if (content === null || typeof content !== "object" || Array.isArray(content)) {
    return reply.code(400).send({ error: "invalid_content" });
  }

  let name = typeof body.name === "string" ? body.name : DEFAULT_NAME;
  if (name.length > MAX_NAME_LEN) name = name.slice(0, MAX_NAME_LEN);

  let database = typeof body.database === "string" ? body.database : DEFAULT_DATABASE;
  if (database.length > MAX_DATABASE_LEN) database = database.slice(0, MAX_DATABASE_LEN);

  let baseVersion;
  if (body.baseVersion === undefined || body.baseVersion === null) {
    baseVersion = null;
  } else if (Number.isInteger(body.baseVersion)) {
    baseVersion = body.baseVersion;
  } else {
    return reply.code(400).send({ error: "invalid_baseVersion" });
  }

  if (body.force !== undefined && typeof body.force !== "boolean") {
    return reply.code(400).send({ error: "invalid_force" });
  }
  const force = body.force === true;

  const contentText = JSON.stringify(content);
  const newHash = sha256Hex(contentText + " " + name + " " + database);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lockRow = async () => {
      const sel = await client.query(
        `SELECT name, "database", content, version, content_hash, deleted_at, updated_at
           FROM diagrams
          WHERE id = $1
          FOR UPDATE`,
        [id],
      );
      return sel.rows[0];
    };

    let row = await lockRow();

    // New diagram (upsert insert). ON CONFLICT covers the race where two
    // clients create the same id concurrently — the loser re-locks the row
    // the winner committed and falls through to the update logic.
    if (!row) {
      const ins = await client.query(
        `INSERT INTO diagrams (id, name, "database", content, version, content_hash, size_bytes)
         VALUES ($1, $2, $3, $4::jsonb, 1, $5, octet_length($4::jsonb::text))
         ON CONFLICT (id) DO NOTHING`,
        [id, name, database, contentText, newHash],
      );
      if (ins.rowCount === 1) {
        await client.query("COMMIT");
        return reply.code(200).send({ version: 1, created: true });
      }
      row = await lockRow();
      if (!row) {
        // The competing transaction rolled back; nothing to converge on.
        await client.query("ROLLBACK");
        return reply.code(503).send({ error: "retry" });
      }
    }

    // Reviving a soft-deleted diagram: overwrite, archive nothing, bump version.
    if (row.deleted_at !== null) {
      const newVersion = row.version + 1;
      await client.query(
        `UPDATE diagrams
            SET name = $2, "database" = $3, content = $4::jsonb, content_hash = $5,
                size_bytes = octet_length($4::jsonb::text), version = $6,
                deleted_at = NULL, updated_at = now()
          WHERE id = $1`,
        [id, name, database, contentText, newHash, newVersion],
      );
      await client.query("COMMIT");
      return reply.code(200).send({ version: newVersion });
    }

    // Identical content/name/database: no-op.
    if (newHash === row.content_hash) {
      await client.query("COMMIT");
      return reply.code(200).send({ version: row.version, unchanged: true });
    }

    // Optimistic concurrency: reject stale writes unless forced.
    if (!force && baseVersion !== row.version) {
      await client.query("ROLLBACK");
      return reply.code(409).send({
        error: "conflict",
        diagramId: id,
        name: row.name,
        database: row.database,
        lastModified: iso(row.updated_at),
        version: row.version,
        content: row.content,
      });
    }

    // Archive the current row before overwriting, then keep newest 30 revisions.
    await client.query(
      `INSERT INTO diagram_revisions (diagram_id, version, name, "database", content)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [id, row.version, row.name, row.database, JSON.stringify(row.content)],
    );
    await client.query(
      `DELETE FROM diagram_revisions
        WHERE diagram_id = $1
          AND id NOT IN (
            SELECT id FROM diagram_revisions
             WHERE diagram_id = $1
             ORDER BY version DESC
             LIMIT $2
          )`,
      [id, KEEP_REVISIONS],
    );

    const newVersion = row.version + 1;
    await client.query(
      `UPDATE diagrams
          SET content = $2::jsonb, name = $3, "database" = $4, content_hash = $5,
              size_bytes = octet_length($2::jsonb::text), version = $6, updated_at = now()
        WHERE id = $1`,
      [id, contentText, name, database, newHash, newVersion],
    );
    await client.query("COMMIT");
    return reply.code(200).send({ version: newVersion });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---- delete route ----------------------------------------------------------

async function deleteDiagram(request, reply) {
  const { id } = request.params;
  // Idempotent: unknown ids simply report success.
  if (!isUuid(id)) {
    return reply.code(200).send({ ok: true });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sel = await client.query(
      `SELECT version, name, "database", content, deleted_at
         FROM diagrams
        WHERE id = $1
        FOR UPDATE`,
      [id],
    );
    if (sel.rows.length > 0 && sel.rows[0].deleted_at === null) {
      const row = sel.rows[0];
      await client.query(
        `INSERT INTO diagram_revisions (diagram_id, version, name, "database", content)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [id, row.version, row.name, row.database, JSON.stringify(row.content)],
      );
      await client.query(
        "UPDATE diagrams SET deleted_at = now() WHERE id = $1",
        [id],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return reply.code(200).send({ ok: true });
}

// ---- revision routes -------------------------------------------------------

async function listRevisions(request, reply) {
  const { id } = request.params;
  if (!isUuid(id)) {
    return reply.code(200).send([]);
  }
  const { rows } = await pool.query(
    `SELECT version, name, created_at, octet_length(content::text) AS size_bytes
       FROM diagram_revisions
      WHERE diagram_id = $1
      ORDER BY version DESC`,
    [id],
  );
  return rows.map((r) => ({
    version: r.version,
    name: r.name,
    createdAt: iso(r.created_at),
    sizeBytes: Number(r.size_bytes),
  }));
}

async function getRevision(request, reply) {
  const { id } = request.params;
  const version = Number(request.params.version);
  if (!isUuid(id) || !Number.isInteger(version)) {
    return reply.code(404).send({ error: "not_found" });
  }
  const { rows } = await pool.query(
    `SELECT version, name, "database", content, created_at
       FROM diagram_revisions
      WHERE diagram_id = $1 AND version = $2`,
    [id, version],
  );
  if (rows.length === 0) {
    return reply.code(404).send({ error: "not_found" });
  }
  const r = rows[0];
  return {
    version: r.version,
    name: r.name,
    database: r.database,
    content: r.content,
    createdAt: iso(r.created_at),
  };
}

// ---- registration ----------------------------------------------------------

export function registerDiagramRoutes(app) {
  // Encapsulated scope so requireSession only guards these routes.
  app.register(async (scope) => {
    scope.addHook("preHandler", requireSession);
    scope.get("/api/diagrams", listDiagrams);
    scope.get("/api/diagrams/:id", getDiagram);
    scope.put("/api/diagrams/:id", putDiagram);
    scope.delete("/api/diagrams/:id", deleteDiagram);
    scope.get("/api/diagrams/:id/revisions", listRevisions);
    scope.get("/api/diagrams/:id/revisions/:version", getRevision);
  });
}
