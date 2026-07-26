// Undo/redo latency in the shipped app, on a 30-table diagram.
//
//   NODE_PATH=<e2e>/node_modules node test/perf/history-perf-e2e.cjs --base=http://localhost:3101
//
// test/perf/history-bench.mjs times the reducer with React removed and gets
// microseconds. That answers "did the extraction slow the reducer down" but not
// "how long does an undo take", because on a 30-table diagram the reducer is a
// rounding error next to re-rendering 30 table cards and PUTting the document.
// This measures the thing the user feels.
//
// Undo entries are produced by real clicks on the inspector's constraint flags
// (Inspector.jsx:469 -> editField), which push one Action.EDIT / ObjectType.TABLE
// / "field" entry each and are correctly reversible.
//
// Each undo is timed in-page: dispatch the keydown, then wait two animation
// frames, so the number includes React's commit and the browser's paint. Driving
// it from Node instead would fold a CDP round-trip into every sample, so that
// figure is reported separately rather than mixed in.

const { chromium } = require("playwright");
const { sleep, login, seed, openEditor, fetchDoc } = require("../e2e/support.cjs");

const TABLES = 30;
const FIELDS = 6;
const OPS = 50;

function content() {
  const tables = [];
  for (let t = 0; t < TABLES; t++) {
    const fields = [];
    for (let f = 0; f < FIELDS; f++) {
      fields.push({
        id: `t${t}f${f}`, name: `field_${f}`, type: f === 0 ? "BIGINT" : "VARCHAR",
        size: f === 0 ? "" : 255, default: "", check: "", primary: f === 0,
        unique: false, notNull: f === 0, increment: false, comment: "",
      });
    }
    tables.push({
      id: `t${t}`, name: `table_${t}`,
      x: (t % 6) * 300, y: Math.floor(t / 6) * 320,
      comment: "", indices: [], uniqueConstraints: [],
      color: "#3f5fc9", locked: false, fields,
    });
  }
  const references = [];
  for (let t = 1; t < TABLES; t++) {
    references.push({
      id: `r${t}`, name: `fk_${t}`,
      startTableId: `t${t - 1}`, endTableId: `t${t}`,
      startFieldId: `t${t - 1}f0`, endFieldId: `t${t}f1`,
      cardinality: "one_to_many", updateConstraint: "No action", deleteConstraint: "No action",
    });
  }
  return {
    gistId: "", tables, references, notes: [],
    areas: [{ id: 0, name: "zone", x: -400, y: 0, width: 300, height: 300, color: "#6965db", locked: false }],
    pan: { x: 0, y: 0 }, zoom: 0.35, types: [], enums: [],
  };
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    total: sum,
    mean: sum / s.length,
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
    max: s[s.length - 1],
  };
};
const fmt = (s) => `total ${s.total.toFixed(1)} ms · mean ${s.mean.toFixed(2)} ms/op · p50 ${s.p50.toFixed(2)} · p95 ${s.p95.toFixed(2)} · max ${s.max.toFixed(2)}`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  let puts = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && /\/api\/diagrams\//.test(r.url())) puts++;
  });

  await login(page);
  const id = await seed(page, `perf ${TABLES} tables`, content());
  await openEditor(page, id);

  const doc = await fetchDoc(page, id);
  console.log(
    `diagram: ${doc.content.tables.length} tables x ${FIELDS} fields ` +
    `(${doc.content.tables.length * FIELDS} fields), ${doc.content.references.length} relationships`,
  );
  console.log(`rendered table cards in the DOM: ${await page.locator(".table-title").count()}`);

  // Silence autosave for the isolated measurement. Settings live in localStorage
  // and the editor has already written the full object once, so patch and reload
  // rather than guessing the default shape.
  const setAutosave = async (on) => {
    await page.evaluate((v) => {
      const s = JSON.parse(localStorage.getItem("settings") || "{}");
      s.autosave = v;
      localStorage.setItem("settings", JSON.stringify(s));
    }, on);
    await openEditor(page, id);
  };

  // Opens one field's card in the inspector and returns its constraint button.
  const armFlagButton = async () => {
    await page.locator(".table-title").first().click({ force: true });
    await page.waitForTimeout(1000);
    const row = page.locator(".frow").nth(1);
    if (!/▾/.test(await row.innerText())) {
      await row.click();
      await page.waitForTimeout(700);
    }
    const flag = page.locator(".fcard .fbody .flags button").filter({ hasText: /^Not null$/i }).first();
    if ((await flag.count()) === 0) throw new Error("could not find the Not null constraint flag");
    return flag;
  };

  const undoBtn = () => page.locator('button[title="Undo"]').first();
  const canUndo = async () => (await undoBtn().getAttribute("disabled")) === null;

  // Builds `n` undo entries with `n` real clicks.
  const buildEntries = async (n) => {
    const flag = await armFlagButton();
    const t0 = Date.now();
    for (let i = 0; i < n; i++) await flag.click();
    await page.waitForTimeout(1200);
    return Date.now() - t0;
  };

  // In-page timing. react-hotkeys-hook attaches a native document keydown
  // listener, so a synthetic event reaches it; verified before it is trusted.
  //
  // The sample is dispatch -> next animation frame, i.e. the reducer plus React's
  // commit plus the paint. It is floor-limited by vsync (16.7 ms at 60 Hz), so it
  // does not resolve work finer than a frame — which is the point: what matters is
  // whether an undo fits inside one frame, and `max` says whether any did not.
  // `longTasks` counts main-thread blocks over 50 ms, the standard jank threshold.
  const timeInPage = async (key, n) =>
    page.evaluate(
      async ({ key: k, n: count }) => {
        const long = [];
        let observer = null;
        try {
          observer = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) long.push(e.duration);
          });
          observer.observe({ entryTypes: ["longtask"] });
        } catch {
          observer = null;
        }
        const frame = () => new Promise((r) => requestAnimationFrame(r));
        const samples = [];
        for (let i = 0; i < count; i++) {
          const t0 = performance.now();
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: k, code: `Key${k.toUpperCase()}`, ctrlKey: true, bubbles: true, cancelable: true }),
          );
          await frame();
          samples.push(performance.now() - t0);
        }
        if (observer) observer.disconnect();
        return { samples, long };
      },
      { key, n },
    );

  const focusCanvas = async () => {
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.waitForTimeout(200);
  };

  // ---- confirm synthetic dispatch actually drives undo -----------------------
  console.log(`\nbuilding ${OPS} undo entries (autosave off)`);
  await setAutosave(false);
  const buildMs = await buildEntries(OPS);
  console.log(`  ${OPS} clicks in ${buildMs} ms, undo available: ${await canUndo()}`);

  await focusCanvas();
  await timeInPage("z", 1);
  // The reliable signal: the redo button must have become enabled.
  const redoOn = (await page.locator('button[title="Redo"]').first().getAttribute("disabled")) === null;
  console.log(`  synthetic keydown drove an undo: ${redoOn}`);
  if (!redoOn) {
    console.log("  falling back to real key presses only");
  }

  const results = [];

  // ---- A: autosave OFF, in-page timing ---------------------------------------
  if (redoOn) {
    // Restore the stack to exactly OPS entries and re-measure cleanly.
    await openEditor(page, id);
    await buildEntries(OPS);
    await focusCanvas();
    const u = await timeInPage("z", OPS);
    const r = await timeInPage("y", OPS);
    results.push([`${OPS} undos  (autosave off, in-page)`, stats(u.samples), u.long]);
    results.push([`${OPS} redos  (autosave off, in-page)`, stats(r.samples), r.long]);
  }

  // ---- B: autosave OFF, real key presses through CDP -------------------------
  await openEditor(page, id);
  await buildEntries(OPS);
  await focusCanvas();
  let t0 = Date.now();
  for (let i = 0; i < OPS; i++) await page.keyboard.press("Control+z");
  const undoWall = Date.now() - t0;
  t0 = Date.now();
  for (let i = 0; i < OPS; i++) await page.keyboard.press("Control+y");
  const redoWall = Date.now() - t0;

  // ---- C: autosave ON, in-page timing (what actually ships) ------------------
  console.log(`\nbuilding ${OPS} undo entries (autosave on)`);
  await setAutosave(true);
  await buildEntries(OPS);
  await focusCanvas();
  puts = 0;
  let undoOn = null;
  let redoOnStats = null;
  let longOn = [];
  if (redoOn) {
    const u = await timeInPage("z", OPS);
    const r = await timeInPage("y", OPS);
    undoOn = stats(u.samples);
    redoOnStats = stats(r.samples);
    longOn = [...u.long, ...r.long];
  }
  const putsFired = puts;
  await sleep(4000);
  const putsSettled = puts;

  // ---- report ----------------------------------------------------------------
  console.log(`\n=== ${OPS} undos + ${OPS} redos on a ${TABLES}-table diagram ===`);
  console.log(`  (vsync floor at 60 Hz is 16.67 ms/op — a mean at the floor means the work fits in one frame)`);
  for (const [label, s, long] of results) {
    console.log(`  ${label.padEnd(38)} ${fmt(s)}`);
    console.log(`  ${"".padEnd(38)} long tasks >50 ms: ${long.length}${long.length ? ` (max ${Math.max(...long).toFixed(0)} ms)` : ""}`);
  }
  console.log(`  ${`${OPS} undos  (autosave off, real keypresses)`.padEnd(38)} total ${undoWall} ms · mean ${(undoWall / OPS).toFixed(2)} ms/op  [includes CDP round-trip]`);
  console.log(`  ${`${OPS} redos  (autosave off, real keypresses)`.padEnd(38)} total ${redoWall} ms · mean ${(redoWall / OPS).toFixed(2)} ms/op  [includes CDP round-trip]`);
  if (undoOn) {
    console.log(`  ${`${OPS} undos  (autosave ON, in-page)`.padEnd(38)} ${fmt(undoOn)}`);
    console.log(`  ${`${OPS} redos  (autosave ON, in-page)`.padEnd(38)} ${fmt(redoOnStats)}`);
    console.log(`  ${"".padEnd(38)} long tasks >50 ms: ${longOn.length}${longOn.length ? ` (max ${Math.max(...longOn).toFixed(0)} ms)` : ""}`);
    console.log(`  PUTs triggered by those ${OPS * 2} ops: ${putsFired} during, ${putsSettled} after settling`);
  }

  const final = await fetchDoc(page, id);
  console.log(`\nfinal document still intact: ${final.content.tables.length} tables, ${final.content.references.length} relationships`);
  // The vercel analytics stub 404s to index.html in this local setup; not history.
  const real = errors.filter((e) => !/_vercel|insights|Unexpected token '<'/i.test(e));
  console.log(`page errors (history-relevant): ${real.length}${real.length ? ` — ${real.slice(0, 2).join(" | ")}` : ""}`);

  await page.evaluate((i) => fetch(`/api/diagrams/${i}`, { method: "DELETE", credentials: "include" }), id).catch(() => {});
  await browser.close();
})().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(2);
});
