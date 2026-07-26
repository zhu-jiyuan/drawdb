// history-smoke.js — the (b) half of the undo/redo characterization harness.
//
// test/run.mjs proves legacy === extracted against a test double. It cannot prove
// that src/utils/history.js actually loads and runs inside Vite/React, nor that
// the double resembles the real contexts. This drives the shipped app through the
// real UI (toolbar tool + canvas click, then ctrl+z / ctrl+y) and asserts on the
// PERSISTED document read back over the HTTP API.
//
//   node test/smoke/history-smoke.cjs --base=http://localhost:3101
//
// NOT part of `node test/run.mjs` and NOT wired into CI: playwright is deliberately
// not a dependency of this repo, so run this from a directory where playwright
// resolves (NODE_PATH=/path/to/e2e/node_modules, or copy it next to one).
// Requires a running server whose STATIC_DIR points at a FRESH `npm run build` —
// @fastify/static is registered with wildcard:false, so it enumerates asset
// filenames at startup and a server older than the build serves index.html for
// the new hashed chunks, which looks like a blank page.

const { chromium, webkit } = require("playwright");
const arg = (n, d) => {
  const h = process.argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.slice(n.length + 3) : d;
};
const BASE = arg("base", process.env.BASE || "http://localhost:3101");
const ENGINE = arg("engine", "chromium");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SEED = async () => {
  const F = (id, name, type, x = {}) => ({
    id, name, type, default: "", check: "", primary: false, unique: false,
    notNull: false, increment: false, comment: "", ...x,
  });
  const tables = [
    {
      id: "t1", name: "users", x: 80, y: 80, comment: "", indices: [],
      uniqueConstraints: [], color: "#3f5fc9", locked: false,
      fields: [
        F("b1", "id", "BIGSERIAL", { primary: true, notNull: true }),
        F("b2", "email", "VARCHAR", { size: 255 }),
      ],
    },
  ];
  const areas = [
    { id: 0, name: "area_0", x: 420, y: 80, width: 180, height: 160, color: "#6965db", locked: false },
  ];
  const id = crypto.randomUUID();
  await fetch("/api/diagrams/" + id, {
    method: "PUT", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "history smoke", database: "postgresql",
      content: { gistId: "", tables, references: [], notes: [], areas, pan: { x: 0, y: 0 }, zoom: 0.8, types: [], enums: [] },
      baseVersion: null, force: false,
    }),
  });
  return id;
};

// Reads the persisted document, polling until `want` holds or we time out.
async function persisted(page, id, want, label) {
  const deadline = Date.now() + 15000;
  let last = null;
  for (;;) {
    last = await page.evaluate(async (d) => {
      const r = await fetch("/api/diagrams/" + d, { credentials: "include" });
      const c = (await r.json()).content ?? {};
      return {
        tables: (c.tables || []).map((t) => t.name),
        areas: (c.areas || []).map((a) => a.name),
      };
    }, id);
    if (want(last) || Date.now() > deadline) break;
    await sleep(400);
  }
  console.log(`    ${label}: tables=[${last.tables}] areas=[${last.areas}]`);
  return last;
}

(async () => {
  const browser = await (ENGINE === "webkit" ? webkit : chromium).launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByPlaceholder("Password").fill("test-password-123");
  await page.getByRole("button", { name: "Log in to cloud" }).click();
  await sleep(2500);
  const id = await page.evaluate(SEED);
  await page.goto(`${BASE}/editor/diagrams/${id}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(4500);

  const results = [];
  const step = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // Places a new element by selecting its toolbar tool and clicking empty canvas.
  async function place(tool, at) {
    await page.getByRole("button", { name: new RegExp(`^${tool}`, "i") }).first().click();
    await sleep(400);
    await page.mouse.click(at.x, at.y);
    await sleep(900);
  }
  // Undo/redo need focus off any input and no active placement tool.
  async function neutral() {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Select/i }).first().click();
    await sleep(300);
  }

  const seeded = await persisted(page, id, () => true, "seeded");
  step("seed persisted 1 table + 1 area", seeded.tables.length === 1 && seeded.areas.length === 1);

  // --- ADD / TABLE: undo must delete the added table, redo must bring it back
  console.log("\nAction.ADD / ObjectType.TABLE");
  await place("Table", { x: 1080, y: 620 });
  const added = await persisted(page, id, (s) => s.tables.length === 2, "after placing a table");
  step("placing a table persisted 2 tables", added.tables.length === 2, `[${added.tables}]`);

  await neutral();
  await page.keyboard.press("Control+z");
  const undone = await persisted(page, id, (s) => s.tables.length === 1, "after ctrl+z");
  step("undo removed the added table", undone.tables.length === 1, `[${undone.tables}]`);
  step("undo kept the original table", undone.tables[0] === "users", `kept "${undone.tables[0]}"`);

  await page.keyboard.press("Control+y");
  const redone = await persisted(page, id, (s) => s.tables.length === 2, "after ctrl+y");
  step("redo restored 2 tables", redone.tables.length === 2, `[${redone.tables}]`);
  step(
    "redo restored the same table, not a regenerated one",
    JSON.stringify(redone.tables) === JSON.stringify(added.tables),
    `${JSON.stringify(added.tables)} -> ${JSON.stringify(redone.tables)}`,
  );

  // --- ADD / AREA: the branch whose undo is positional (deletes the LAST area,
  // not the one the entry names). Confirms the preserved quirk round-trips.
  console.log("\nAction.ADD / ObjectType.AREA");
  await place("Area", { x: 1250, y: 300 });
  const a2 = await persisted(page, id, (s) => s.areas.length === 2, "after placing an area");
  step("placing an area persisted 2 areas", a2.areas.length === 2, `[${a2.areas}]`);

  await neutral();
  await page.keyboard.press("Control+z");
  const a1 = await persisted(page, id, (s) => s.areas.length === 1, "after ctrl+z");
  step("undo removed the added area", a1.areas.length === 1, `[${a1.areas}]`);
  step("undo kept the original area", a1.areas[0] === "area_0", `kept "${a1.areas[0]}"`);

  await page.keyboard.press("Control+y");
  const a2b = await persisted(page, id, (s) => s.areas.length === 2, "after ctrl+y");
  step("redo restored 2 areas", a2b.areas.length === 2, `[${a2b.areas}]`);

  // Ignore known unrelated noise: the vercel analytics stub 404s to index.html
  // and /api/auth/me 401s in this local setup; neither involves history.
  const real = errors.filter(
    (e) => !/favicon|manifest|ResizeObserver|_vercel|insights|auth\/me|401|Unexpected token '<'/i.test(e),
  );
  step("no page errors while applying history", real.length === 0, real.slice(0, 3).join(" | "));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "FAIL" : "PASS"}  ${results.length - failed.length}/${results.length} checks`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})();
