// history-gaps.cjs — the three undo/redo gaps nobody covered.
//
// The extraction harness (test/run.mjs) proves the reducer is a faithful
// mirror of the old towers. It says nothing about whether the *stack* still
// describes the document by the time an entry is applied. Every check here is
// about that: state mutated outside the stack, state replaced under the stack,
// and state changed by somebody who is not this browser.
//
//   G1  Auto arrange rewrites every table's x/y and records no history entry.
//       Is the arrangement recoverable? Does the entry underneath still line up
//       with the document?
//   G2  Undo across a diagram switch. The stacks are in memory; is any entry
//       from diagram A still live once diagram B is loaded?
//   G3  A write by the MCP server (== a REST write with the MCP bearer, which
//       is literally how server/mcp-http.js executes tool calls) lands while the
//       editor is open. Does a subsequent Ctrl+Z in the UI destroy it?
//
// Run:  NODE_PATH=<e2e>/node_modules node test/e2e/history-gaps.cjs
// Needs a server whose STATIC_DIR is a fresh `npm run build`.

const { chromium } = require("playwright");
const {
  BASE, sleep, login, seed, openEditor, fetchDoc, waitForServer, hotkey,
  reporter, realErrors,
} = require("./support.cjs");

const MCP_KEY = process.env.MCP_KEY || "test-mcp-key";

const F = (id, name, type, extra = {}) => ({
  id, name, type, default: "", check: "", primary: false, unique: false,
  notNull: false, increment: false, comment: "", ...extra,
});

const T = (id, name, x, y) => ({
  id, name, x, y, comment: "", indices: [], uniqueConstraints: [],
  color: "#6259cf", locked: false,
  fields: [F(`${id}_f1`, "id", "BIGINT", { primary: true, notNull: true })],
});

// Four tables on a deliberately untidy diagonal, so auto arrange has to move
// all of them and any partial revert is obvious.
const CONTENT = () => ({
  gistId: "",
  tables: [
    T("t1", "alpha", 100, 100),
    T("t2", "beta", 460, 260),
    T("t3", "gamma", 820, 420),
    T("t4", "delta", 1180, 580),
  ],
  references: [],
  notes: [],
  // Keeps Workspace's dirty effect off its all-empty early return even if the
  // table count dips.
  areas: [{ id: 0, name: "zone", x: 60, y: 700, width: 200, height: 160, color: "#6965db", locked: false }],
  pan: { x: 0, y: 0 },
  zoom: 0.6,
  types: [],
  enums: [],
});

const posOf = (doc) =>
  Object.fromEntries(
    (doc.content.tables || []).map((t) => [t.name, `${Math.round(t.x)},${Math.round(t.y)}`]),
  );
const namesOf = (doc) => (doc.content.tables || []).map((t) => t.name).join(",");
const pos = (doc) => JSON.stringify(posOf(doc));

// Records one undoable ADD by selecting a toolbar tool and clicking empty
// canvas — the recipe test/smoke/history-smoke.cjs already proves works.
async function place(page, tool, at) {
  await page.getByRole("button", { name: new RegExp(`^${tool}`, "i") }).first().click();
  await sleep(400);
  await page.mouse.click(at.x, at.y);
  await sleep(1200);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Select/i }).first().click();
  await sleep(300);
}

// Is an undo currently offered? Reads the toolbar affordance, which is the only
// thing telling the user whether the last change is recoverable.
async function canUndo(page) {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll("button,[role=button]")].find((e) =>
      /undo/i.test(e.getAttribute("aria-label") || e.title || ""));
    return b ? !(b.disabled || b.getAttribute("aria-disabled") === "true") : null;
  });
}

// Runs a command-palette entry by its visible label.
async function palette(page, label) {
  await page.keyboard.press("Control+k");
  const box = page.getByPlaceholder(/search|command/i).first();
  await box.waitFor({ timeout: 8000 });
  await box.fill(label);
  await sleep(400);
  await page.getByText(label, { exact: true }).first().click();
  await sleep(900);
}

// A write with the MCP bearer. server/mcp-http.js runs every MCP tool call by
// re-entering this same REST route with this same key, so this is an MCP write.
async function mcpWrite(page, id, doc, mutate) {
  const next = JSON.parse(JSON.stringify(doc.content));
  mutate(next);
  return page.evaluate(
    async ({ i, content, baseVersion, key }) => {
      const r = await fetch(`/api/diagrams/${i}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ name: "gaps", database: "postgresql", content, baseVersion, force: false }),
      });
      return { status: r.status, body: await r.text() };
    },
    { i: id, content: next, baseVersion: doc.version, key: MCP_KEY },
  );
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const r = reporter();

  try {
    await login(page);

    // ------------------------------------------------------------------ G1
    // Auto arrange: no history entry, so the previous layout has no way back.
    {
      const id = await seed(page, "G1 auto arrange", CONTENT());
      await openEditor(page, id);
      const before = await fetchDoc(page, id);
      r.step("G1 seeded 4 tables", namesOf(before) === "alpha,beta,gamma,delta", namesOf(before));
      const p0 = pos(before);

      // Nothing has been edited yet, so the undo affordance must be off. This
      // also proves the probe below can read `false`.
      r.step("G1 no undo offered before any edit", (await canUndo(page)) === false);

      await palette(page, "Auto arrange");
      const arranged = await waitForServer(page, id, (d) => pos(d) !== p0, 15000);
      const p1 = pos(arranged);
      r.step("G1 auto arrange moved tables and was persisted", p1 !== p0, `${p0} -> ${p1}`);

      // Asked before pressing anything: if auto arrange records no entry, the
      // arrangement has no way back and the button stays disabled.
      const offered = await canUndo(page);
      r.step("G1 an undo is offered after auto arrange", offered === true, `canUndo=${offered}`);

      // The only thing a user has to reach for.
      await hotkey(page, "Control+z");
      await sleep(2500);
      const afterUndo = await fetchDoc(page, id);
      const recovered = pos(afterUndo) === p0;
      r.step("G1 Ctrl+Z restores the pre-arrange layout", recovered,
        recovered ? "" : `still ${pos(afterUndo)} (wanted ${p0})`);
    }

    // ---------------------------------------------------------------- G1b
    // Stack desync: an entry recorded BEFORE auto arrange is replayed AFTER it.
    // The ADD entry carries the table verbatim, coordinates included, so redo
    // re-inserts it where it was before the arrangement.
    {
      const id = await seed(page, "G1b desync", CONTENT());
      await openEditor(page, id);
      await place(page, "Table", { x: 900, y: 640 });
      const added = await waitForServer(page, id, (d) => d.content.tables.length === 5, 15000);
      r.step("G1b a 5th table was added and recorded", added.content.tables.length === 5,
        namesOf(added));
      const newName = (added.content.tables[4] || {}).name;
      const placedAt = posOf(added)[newName];

      await palette(page, "Auto arrange");
      const arranged = await waitForServer(page, id, (d) => posOf(d)[newName] !== placedAt, 15000);
      const arrangedAt = posOf(arranged)[newName];
      r.step("G1b auto arrange moved the new table", arrangedAt !== placedAt,
        `${newName} ${placedAt} -> ${arrangedAt}`);

      // Undo 1 must be the arrangement (the entry auto arrange now records),
      // undo 2 the ADD underneath it. If auto arrange records nothing, undo 1
      // removes the table and this fails on the table count.
      await hotkey(page, "Control+z");
      const unarranged = await waitForServer(page, id, (d) => posOf(d)[newName] === placedAt, 15000);
      r.step("G1b undo 1 reverts the arrangement, not the entry underneath",
        unarranged.content.tables.length === 5 && posOf(unarranged)[newName] === placedAt,
        `tables=${unarranged.content.tables.length} ${newName}@${posOf(unarranged)[newName]}`);

      await hotkey(page, "Control+z");
      const gone = await waitForServer(page, id, (d) => d.content.tables.length === 4, 15000);
      r.step("G1b undo 2 removes the added table", gone.content.tables.length === 4, namesOf(gone));

      await hotkey(page, "Control+y"); // redo the ADD
      const readded = await waitForServer(page, id, (d) => d.content.tables.length === 5, 15000);
      r.step("G1b redo 1 re-adds the table where it was placed",
        posOf(readded)[newName] === placedAt, `${newName}@${posOf(readded)[newName]}`);

      await hotkey(page, "Control+y"); // redo the arrangement
      const rearranged = await waitForServer(page, id, (d) => posOf(d)[newName] === arrangedAt, 15000);
      const redoneAt = posOf(rearranged)[newName];
      r.step("G1b redo 2 puts the table back where the arrangement had it",
        redoneAt === arrangedAt,
        redoneAt === arrangedAt ? "" : `redone at ${redoneAt}, arrangement had ${arrangedAt}`);
      r.step("G1b full round trip matches the arranged layout",
        pos(rearranged) === pos(arranged), `${pos(arranged)} vs ${pos(rearranged)}`);
    }

    // ------------------------------------------------------------------ G2
    // Undo across a diagram switch, in-SPA (no page reload), then reloaded.
    {
      const idA = await seed(page, "G2 diagram A", CONTENT());
      const b = CONTENT();
      b.tables = [T("s1", "solo", 300, 300)];
      const idB = await seed(page, "G2 diagram B", b);

      await openEditor(page, idA);
      // Two recordable edits on A: two placed tables, so A's stack has depth 2.
      // Spread apart, and Escape between them, or the second click lands on the
      // inspector the first placement opened.
      await place(page, "Table", { x: 700, y: 300 });
      await page.keyboard.press("Escape");
      await sleep(600);
      await place(page, "Table", { x: 520, y: 700 });
      const aEdited = await waitForServer(page, idA, (d) => d.content.tables.length === 6, 15000);
      r.step("G2 diagram A has 2 undoable edits", aEdited.content.tables.length === 6,
        `tables=${aEdited.content.tables.length}`);
      const aShape = `${aEdited.content.tables.length}/${aEdited.content.areas.length}`;

      // In-SPA navigation: back to the diagram list, then open B by clicking.
      const bDoc0 = await fetchDoc(page, idB);
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.getByText("Recent diagrams").waitFor({ timeout: 20000 });
      await page.getByText("G2 diagram B", { exact: true }).first().click();
      await sleep(5000);
      const onB = page.url().includes(idB);
      r.step("G2 navigated to diagram B", onB, page.url());

      // The sharpest form of the question: on freshly-loaded B, is A's stack
      // still live? If loadDiagram forgot to clear it, an undo is offered here.
      const offeredOnB = await canUndo(page);
      r.step("G2 no undo offered on the newly loaded diagram", offeredOnB === false,
        `canUndo=${offeredOnB}`);

      // Now hammer undo on B. Nothing from A may apply.
      for (let i = 0; i < 4; i++) await hotkey(page, "Control+z");
      await sleep(3000);
      const bAfter = await fetchDoc(page, idB);
      r.step("G2 diagram B untouched by A's stack",
        namesOf(bAfter) === namesOf(bDoc0) && pos(bAfter) === pos(bDoc0),
        `${namesOf(bDoc0)}@v${bDoc0.version} -> ${namesOf(bAfter)}@v${bAfter.version}`);
      r.step("G2 no table from A leaked into B",
        !/alpha|beta|gamma|delta/.test(namesOf(bAfter)), namesOf(bAfter));

      // And A is left as it was: its edits are NOT recoverable after the switch.
      const aAfter = await fetchDoc(page, idA);
      r.step("G2 A's document is unchanged by undos pressed on B",
        `${aAfter.content.tables.length}/${aAfter.content.areas.length}` === aShape,
        `${aShape} -> ${aAfter.content.tables.length}/${aAfter.content.areas.length}`);
      r.step("G2 no page error during the switch", realErrors(errors).length === 0,
        realErrors(errors).slice(0, 2).join(" | "));
    }

    // ------------------------------------------------------------------ G3
    // An MCP write lands while the editor is open, then the user hits Ctrl+Z.
    {
      const id = await seed(page, "G3 mcp race", CONTENT());
      await openEditor(page, id);

      // One local undoable edit, saved.
      await place(page, "Table", { x: 800, y: 600 });
      const local = await waitForServer(page, id, (d) => d.content.tables.length === 5, 15000);
      r.step("G3 local edit saved", local.content.tables.length === 5,
        `v${local.version} ${namesOf(local)}`);

      // MCP adds a table the browser has never seen.
      const w = await mcpWrite(page, id, local, (c) => {
        c.tables.push(T("m1", "mcp_added", 2000, 200));
      });
      r.step("G3 MCP write accepted", w.status === 200, `HTTP ${w.status} ${w.body.slice(0, 120)}`);
      const afterMcp = await fetchDoc(page, id);
      r.step("G3 MCP table is on the server", namesOf(afterMcp).includes("mcp_added"), namesOf(afterMcp));

      // The user, unaware, undoes their own edit.
      await hotkey(page, "Control+z");
      await sleep(4000);
      const afterUndo = await fetchDoc(page, id);
      const survived = namesOf(afterUndo).includes("mcp_added");
      r.step("G3 MCP table survives the UI's undo", survived,
        survived ? namesOf(afterUndo) : `LOST — server now ${namesOf(afterUndo)} @v${afterUndo.version}`);

      // Whatever happened, the user must be told. Either the undo was refused
      // (conflict overlay) or it went through cleanly; a silent overwrite is the
      // failure mode.
      const warned = await page.evaluate(() =>
        /conflict|newer version|out of date|reload/i.test(document.body.innerText));
      r.step("G3 either MCP survived or the user was warned", survived || warned,
        `survived=${survived} warned=${warned}`);
      // The undo's PUT is refused by the version CAS, so the undo the user just
      // performed is on screen only. Record which it was, so the report can say
      // so precisely rather than guessing.
      r.step("G3 the undo's write was refused rather than merged",
        afterUndo.version === afterMcp.version,
        `v${afterMcp.version} -> v${afterUndo.version}`);
    }
  } catch (e) {
    r.step("harness completed", false, String(e && e.stack ? e.stack.split("\n")[0] : e));
  }

  const bad = r.finish("history-gaps");
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
