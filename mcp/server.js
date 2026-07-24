// server.js — builds a configured McpServer bound to a DrawdbClient. Shared by
// the stdio entry (index.js) and the backend's Streamable HTTP endpoint, so
// both transports expose exactly the same six tools.

import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ApiError } from "./api.js";
import {
  DATABASES,
  CARDINALITIES,
  CONSTRAINTS,
  normalizeDatabase,
  buildContent,
  applyOps,
  ensureContentArrays,
  simplifyDiagram,
} from "./shapes.js";

// ---- zod input shapes ------------------------------------------------------

const zSimpleField = z
  .object({
    name: z.string().describe("Column name."),
    type: z
      .string()
      .describe(
        "SQL type, matching the diagram's dialect, e.g. INT, BIGINT, VARCHAR, TEXT, TIMESTAMP, BOOLEAN. Stored uppercased.",
      ),
    primary: z.boolean().optional().describe("Primary key (implies notNull + unique)."),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
    increment: z.boolean().optional().describe("Auto-increment / serial."),
    default: z
      .union([z.string(), z.number(), z.boolean()])
      .optional()
      .describe("Default value expression."),
    size: z
      .union([z.string(), z.number()])
      .optional()
      .describe("Length/precision, e.g. 255 for VARCHAR(255)."),
    values: z
      .array(z.string())
      .optional()
      .describe("Allowed values for ENUM/SET types."),
    comment: z.string().optional(),
  })
  .describe("A simplified column definition.");

const zSimpleTable = z.object({
  name: z.string(),
  comment: z.string().optional(),
  fields: z.array(zSimpleField).min(1).describe("At least one column."),
});

const zSimpleRel = z
  .object({
    fromTable: z.string().describe("Child table (the FK holder)."),
    fromField: z.string().describe("FK column on the child table."),
    toTable: z.string().describe("Parent (referenced) table."),
    toField: z.string().describe("Referenced column on the parent table."),
    cardinality: z.enum(CARDINALITIES).optional().describe('Default "many_to_one".'),
    onDelete: z.enum(CONSTRAINTS).optional(),
    onUpdate: z.enum(CONSTRAINTS).optional(),
  })
  .describe("A foreign-key relationship. `from` is the child/FK side.");

// ---- MCP result helpers ----------------------------------------------------

function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

function fail(err) {
  const message =
    err instanceof ApiError || err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

const EDITOR_NOTE =
  'If the user has this diagram open in the drawdb editor, they will see a "newer version" banner and can reload to pull your changes.';

export function buildMcpServer(client, { editorBase }) {
  const editorUrl = (id) => `${editorBase}/editor/diagrams/${id}`;

  // Optimistic-concurrency write: read current, apply, PUT with baseVersion.
  // On 409, re-read from the conflict payload, re-apply, and retry exactly once.
  async function saveWithCas(diagramId, applyFn) {
    let server = await client.request("GET", `/api/diagrams/${diagramId}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      const { name, database, content } = applyFn(server);
      try {
        const res = await client.request("PUT", `/api/diagrams/${diagramId}`, {
          name,
          database,
          content,
          baseVersion: server.version,
          force: false,
        });
        return res.version;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && attempt === 0 && err.data) {
          // The 409 body carries the server's fresh version + content.
          server = {
            diagramId,
            name: err.data.name,
            database: err.data.database,
            version: err.data.version,
            content: err.data.content,
          };
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      "Save aborted: the diagram was changed by someone else twice while saving. Re-read it and try again.",
    );
  }

  const server = new McpServer({ name: "drawdb-mcp", version: "1.0.0" });

  server.registerTool(
    "list_diagrams",
    {
      title: "List diagrams",
      description:
        "List all diagrams in the drawdb cloud account (name, database dialect, last-modified, size) each with its editor URL.",
      inputSchema: {},
    },
    async () => {
      try {
        const rows = await client.request("GET", "/api/diagrams");
        const list = (rows || []).map((d) => ({ ...d, url: editorUrl(d.diagramId) }));
        return ok(list);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_diagram",
    {
      title: "Get diagram",
      description:
        "Read one diagram as a simplified schema view: tables with their fields and the foreign-key relationships between them, plus counts of notes/areas/enums/types that exist but are not shown. Set include_layout to also return each table's x/y/color.",
      inputSchema: {
        diagramId: z.string().describe("The diagram's UUID."),
        include_layout: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include table x/y coordinates and color."),
      },
    },
    async ({ diagramId, include_layout }) => {
      try {
        const server_ = await client.request("GET", `/api/diagrams/${diagramId}`);
        return ok(simplifyDiagram(server_, editorUrl(diagramId), include_layout === true));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "create_diagram",
    {
      title: "Create diagram",
      description:
        "Create a new database diagram. Provide tables (each with fields) and optional foreign-key relationships; the server generates ids and auto-lays-out the tables on a grid. Field `type` strings should match the chosen SQL dialect (e.g. INT, BIGINT, VARCHAR with size, TEXT, TIMESTAMP, BOOLEAN). Returns the new diagramId, editor URL, and version. " +
        EDITOR_NOTE,
      inputSchema: {
        name: z.string().describe("Diagram title."),
        database: z
          .enum(DATABASES)
          .optional()
          .default("generic")
          .describe("SQL dialect."),
        tables: z.array(zSimpleTable).min(1),
        relationships: z.array(zSimpleRel).optional(),
      },
    },
    async ({ name, database, tables, relationships }) => {
      try {
        const db = normalizeDatabase(database);
        const content = buildContent(db, tables, relationships);
        const id = crypto.randomUUID();
        const res = await client.request("PUT", `/api/diagrams/${id}`, {
          name,
          database: db,
          content,
          baseVersion: null,
          force: false,
        });
        return ok({ diagramId: id, url: editorUrl(id), version: res.version });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "update_diagram",
    {
      title: "Update diagram",
      description:
        "Apply incremental changes to an existing diagram. Operations are applied in this order: set_name, add_tables, drop_tables, rename_tables, add_fields, drop_fields, modify_fields, add_relationships, drop_relationships. Dropping a table also drops any relationships touching it. Tables/fields are referenced by name (must exist). Uses optimistic concurrency and preserves everything you don't touch (layout, notes, areas, enums/types). " +
        EDITOR_NOTE,
      inputSchema: {
        diagramId: z.string(),
        set_name: z.string().optional().describe("Rename the diagram."),
        add_tables: z.array(zSimpleTable).optional(),
        drop_tables: z.array(z.string()).optional().describe("Table names to remove."),
        rename_tables: z
          .array(z.object({ from: z.string(), to: z.string() }))
          .optional(),
        add_fields: z
          .array(z.object({ table: z.string(), fields: z.array(zSimpleField).min(1) }))
          .optional(),
        drop_fields: z
          .array(z.object({ table: z.string(), field: z.string() }))
          .optional(),
        modify_fields: z
          .array(
            z.object({
              table: z.string(),
              field: z.string(),
              set: zSimpleField.partial().describe("Fields to change on this column."),
            }),
          )
          .optional(),
        add_relationships: z.array(zSimpleRel).optional(),
        drop_relationships: z
          .array(z.string())
          .optional()
          .describe("Relationship names to remove."),
      },
    },
    async (args) => {
      try {
        const { diagramId } = args;
        let summary = [];
        const version = await saveWithCas(diagramId, (srv) => {
          const content = structuredClone(srv.content || {});
          ensureContentArrays(content);
          const opSummary = applyOps(content, args);
          summary =
            args.set_name != null
              ? [`renamed diagram to "${args.set_name}"`, ...opSummary]
              : opSummary;
          const name = args.set_name != null ? args.set_name : srv.name;
          return { name, database: srv.database, content };
        });
        return ok({
          diagramId,
          version,
          applied: summary.length > 0 ? summary : ["no changes"],
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "delete_diagram",
    {
      title: "Delete diagram",
      description:
        "Delete a diagram. Requires confirm:true. This is a soft delete on the server (recoverable for ~30 days).",
      inputSchema: {
        diagramId: z.string(),
        confirm: z
          .boolean()
          .describe("Must be true to actually delete. A safety guard."),
      },
    },
    async ({ diagramId, confirm }) => {
      try {
        if (confirm !== true) {
          return fail(new Error("Refusing to delete: pass confirm:true to proceed."));
        }
        await client.request("DELETE", `/api/diagrams/${diagramId}`);
        return ok({
          ok: true,
          diagramId,
          note: "Soft-deleted; recoverable on the server for ~30 days.",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_revisions",
    {
      title: "List revisions",
      description:
        "List the saved revision history of a diagram (version, name, timestamp, size), newest first. Restoring a revision is not exposed in v1 — this is informational so you can tell the user which version to roll back to in the editor.",
      inputSchema: {
        diagramId: z.string(),
      },
    },
    async ({ diagramId }) => {
      try {
        const rows = await client.request("GET", `/api/diagrams/${diagramId}/revisions`);
        return ok(rows || []);
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
