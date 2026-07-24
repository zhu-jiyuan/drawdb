import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://drawdb:drawdb@localhost:5432/drawdb";

// A single shared connection pool for the whole process.
export const pool = new Pool({ connectionString: DATABASE_URL });

// Apply schema.sql idempotently on boot. Every statement in the file uses
// CREATE ... IF NOT EXISTS, so this is safe to run on every start.
export async function runSchema() {
  const sql = await readFile(join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
}
