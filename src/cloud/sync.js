import { db } from "../data/db";
import {
  listDiagrams,
  getDiagram,
  putDiagram,
  deleteDiagram,
  isNetworkError,
} from "./api";

// Last server version we have seen per diagram. Only updated on successful
// round-trips — it is the baseVersion for optimistic concurrency (CAS).
const versions = new Map();

// --- tiny observable store for the overlay UI ---------------------------------

const state = {
  pending: 0,
  // { diagramId, server: {name, database, lastModified, version, content} }
  conflict: null,
  // set when a newer version was seen on the server while the editor is clean
  freshVersion: null,
  offline: false,
  // set when a save was rejected because the diagram was deleted elsewhere
  deletedRemotely: null,
};

const listeners = new Set();

export function subscribeSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSyncState() {
  return state;
}

function notify() {
  for (const fn of listeners) fn({ ...state });
}

async function refreshPending() {
  state.pending = await db.cloudMirror
    .filter((row) => row.pending === 1)
    .count();
  notify();
}

// --- shape mapping ------------------------------------------------------------
// The wire `content` is exactly the editor payload minus the columns the server
// promotes (diagramId, name, database, lastModified).

function splitPayload(payload) {
  const { diagramId, name, database, lastModified, ...content } = payload;
  return { diagramId, name, database, lastModified, content };
}

function toDexieRow(server) {
  return {
    diagramId: server.diagramId,
    name: server.name,
    database: server.database,
    lastModified: new Date(server.lastModified),
    canWrite: true,
    ...server.content,
  };
}

function mirrorToRow(mirror) {
  return {
    diagramId: mirror.diagramId,
    name: mirror.name,
    database: mirror.database,
    lastModified: mirror.lastModified,
    canWrite: true,
    ...mirror.content,
  };
}

// --- per-diagram flush serialization -------------------------------------------
// Only one PUT per diagram may be in flight; otherwise concurrent flushes (save
// + interval + focus + second tab) race each other's baseVersion and clobber
// the mirror with stale snapshots.

const flushChains = new Map();

function withFlushLock(diagramId, fn) {
  const prev = flushChains.get(diagramId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  flushChains.set(diagramId, next);
  next.finally(() => {
    if (flushChains.get(diagramId) === next) flushChains.delete(diagramId);
  });
  return next;
}

// --- core sync ----------------------------------------------------------------

// Runs inside the per-diagram lock. Sends the mirror's pending content and
// commits the outcome without clobbering writes that landed mid-flight.
async function flushOneLocked(diagramId) {
  const mirror = await db.cloudMirror.get(diagramId);
  if (!mirror || mirror.pending !== 1 || mirror.conflicted === 1) return;
  const sentSeq = mirror.seq ?? 0;

  let data;
  try {
    ({ data } = await putDiagram(diagramId, {
      name: mirror.name,
      database: mirror.database,
      content: mirror.content,
      baseVersion: mirror.baseVersion ?? null,
      force: mirror.force === true,
    }));
  } catch (err) {
    // 410: the diagram was deleted elsewhere. Not transient — drop the local
    // mirror instead of retrying (which used to resurrect it server-side).
    if (err?.response?.status === 410) {
      await db.cloudMirror.delete(diagramId);
      versions.delete(diagramId);
      state.deletedRemotely = diagramId;
      notify();
      return;
    }
    if (err?.response?.status === 409) {
      await db.cloudMirror
        .where("diagramId")
        .equals(diagramId)
        .modify({ conflicted: 1 });
      setConflict(diagramId, err.response.data);
    }
    throw err;
  }

  versions.set(diagramId, data.version);
  await db.transaction("rw", db.cloudMirror, async () => {
    const current = await db.cloudMirror.get(diagramId);
    if (!current) return;
    if ((current.seq ?? 0) === sentSeq) {
      await db.cloudMirror.put({
        ...current,
        pending: 0,
        force: false,
        conflicted: 0,
        baseVersion: null,
        version: data.version,
      });
    } else {
      // A newer save landed while the PUT was in flight: keep it pending but
      // rebase it onto the version we just acknowledged, so its own flush
      // CASes against our commit instead of conflicting with it.
      await db.cloudMirror.put({
        ...current,
        baseVersion: data.version,
        version: data.version,
      });
    }
  });
}

export async function flushOutbox() {
  const pendingRows = await db.cloudMirror
    .filter((row) => row.pending === 1 && row.conflicted !== 1)
    .toArray();

  for (const row of pendingRows) {
    try {
      await withFlushLock(row.diagramId, () => flushOneLocked(row.diagramId));
      state.offline = false;
    } catch (err) {
      if (isNetworkError(err)) {
        state.offline = true;
        break;
      }
      // conflicts were recorded by flushOneLocked; other HTTP errors stay
      // pending for a later retry
    }
  }
  await refreshPending();
}

// First-wins: while the user is deciding, the modal must not silently switch
// to a different diagram. Later conflicts stay flagged on their mirror rows
// and are surfaced after this one resolves.
function setConflict(diagramId, server) {
  if (state.conflict && state.conflict.diagramId !== diagramId) return;
  state.conflict = { diagramId, server };
  notify();
}

async function surfaceNextConflict() {
  const next = await db.cloudMirror
    .filter((row) => row.conflicted === 1)
    .first();
  if (!next) return;
  // Re-flush it: the 409 comes back with fresh server content and reopens the
  // modal for this diagram.
  await db.cloudMirror
    .where("diagramId")
    .equals(next.diagramId)
    .modify({ conflicted: 0 });
  withFlushLock(next.diagramId, () => flushOneLocked(next.diagramId)).catch(
    () => {},
  );
}

// choice: "theirs" adopts the server row (caller reloads the editor);
// "mine" force-pushes the pending mirror content.
export async function resolveConflict(choice) {
  const conflict = state.conflict;
  if (!conflict) return null;
  const { diagramId, server } = conflict;

  if (choice === "theirs") {
    versions.set(diagramId, server.version);
    await db.cloudMirror.put({
      diagramId,
      name: server.name,
      database: server.database,
      lastModified: new Date(server.lastModified),
      content: server.content,
      pending: 0,
      force: false,
      conflicted: 0,
      baseVersion: null,
      seq: 0,
      version: server.version,
    });
  } else {
    await db.cloudMirror
      .where("diagramId")
      .equals(diagramId)
      .modify({ pending: 1, force: true, conflicted: 0 });
    await withFlushLock(diagramId, () => flushOneLocked(diagramId));
  }

  state.conflict = null;
  await refreshPending();
  surfaceNextConflict();
  return conflict;
}

// Returns the server row when it is newer than what we last saw and null
// otherwise. Used by the overlay's window-focus freshness check.
export async function checkFresh(diagramId) {
  const known = versions.get(diagramId);
  if (known == null) return null;
  const { data } = await getDiagram(diagramId);
  if (data.version > known) {
    state.freshVersion = { diagramId, version: data.version };
    notify();
    return data;
  }
  return null;
}

export function clearFresh() {
  state.freshVersion = null;
  notify();
}

// --- the ExtensionsContext contract -------------------------------------------

export async function cloudSave(payload) {
  const { diagramId, name, database, lastModified, content } =
    splitPayload(payload);

  await db.transaction("rw", db.cloudMirror, async () => {
    const existing = await db.cloudMirror.get(diagramId);
    await db.cloudMirror.put({
      ...existing,
      diagramId,
      name,
      database,
      lastModified,
      content,
      pending: 1,
      seq: (existing?.seq ?? 0) + 1,
      conflicted: existing?.conflicted === 1 ? 1 : 0,
      // keep the base of the first unflushed write; a fresh write bases on the
      // last version the server acknowledged
      baseVersion:
        existing?.pending === 1
          ? (existing.baseVersion ?? null)
          : (versions.get(diagramId) ?? null),
    });
  });

  // While a conflict on this diagram awaits the user's decision, keep the new
  // content queued locally (the modal outcome determines what happens to it).
  const mirror = await db.cloudMirror.get(diagramId);
  if (mirror?.conflicted === 1) {
    await refreshPending();
    const err = new Error("conflict pending resolution");
    err.response = { status: 409 };
    throw err;
  }

  try {
    await withFlushLock(diagramId, () => flushOneLocked(diagramId));
    state.offline = false;
  } catch (err) {
    if (isNetworkError(err)) {
      // saved locally; the outbox will sync when we're back online
      state.offline = true;
      await refreshPending();
      return;
    }
    await refreshPending();
    throw err;
  }
  await refreshPending();
}

export async function cloudLoad(diagramId) {
  const mirror = await db.cloudMirror.get(diagramId);
  // unsynced local edits are newer than anything the server has
  if (mirror?.pending === 1) return mirrorToRow(mirror);

  try {
    const { data } = await getDiagram(diagramId);
    versions.set(diagramId, data.version);
    await db.transaction("rw", db.cloudMirror, async () => {
      const current = await db.cloudMirror.get(diagramId);
      if (current?.pending === 1) return; // a save won the race; keep it
      await db.cloudMirror.put({
        diagramId,
        name: data.name,
        database: data.database,
        lastModified: new Date(data.lastModified),
        content: data.content,
        pending: 0,
        force: false,
        conflicted: 0,
        baseVersion: null,
        seq: current?.seq ?? 0,
        version: data.version,
      });
    });
    return toDexieRow(data);
  } catch (err) {
    if (err?.response?.status === 404) {
      await db.cloudMirror.delete(diagramId);
      return null;
    }
    // Network failure or server error: fall back to the offline mirror.
    if (mirror) {
      if (isNetworkError(err)) {
        state.offline = true;
        notify();
      }
      if (mirror.version != null && !versions.has(diagramId)) {
        versions.set(diagramId, mirror.version);
      }
      return mirrorToRow(mirror);
    }
    return null;
  }
}

export async function cloudList() {
  // Snapshot before the request: a diagram created while the request is in
  // flight must not be mistaken for one deleted on the server.
  const before = new Map(
    (await db.cloudMirror.toArray()).map((m) => [m.diagramId, m]),
  );

  try {
    const { data } = await listDiagrams();
    state.offline = false;

    // tombstone propagation: drop mirrors the server no longer has, but only
    // rows that were clean both before and after the round-trip
    const serverIds = new Set(data.map((d) => d.diagramId));
    const after = await db.cloudMirror.toArray();
    for (const mirror of after) {
      const pre = before.get(mirror.diagramId);
      const cleanNow = mirror.pending !== 1 && mirror.conflicted !== 1;
      const cleanBefore = pre != null && pre.pending !== 1;
      if (cleanNow && cleanBefore && !serverIds.has(mirror.diagramId)) {
        await db.cloudMirror.delete(mirror.diagramId);
        versions.delete(mirror.diagramId);
      }
    }

    // diagrams created offline that the server hasn't seen yet
    const pendingExtra = after
      .filter((m) => m.pending === 1 && !serverIds.has(m.diagramId))
      .map((m) => ({
        diagramId: m.diagramId,
        name: m.name,
        database: m.database,
        lastModified: m.lastModified,
        sizeBytes: JSON.stringify(m.content).length,
      }));

    notify();
    return [...data, ...pendingExtra];
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    state.offline = true;
    notify();
    const mirrors = await db.cloudMirror.toArray();
    return mirrors.map((m) => ({
      diagramId: m.diagramId,
      name: m.name,
      database: m.database,
      lastModified: m.lastModified,
      sizeBytes: JSON.stringify(m.content).length,
    }));
  }
}

export async function cloudDelete(diagramId) {
  await deleteDiagram(diagramId);
  await db.cloudMirror.delete(diagramId);
  // A pre-migration local row under the same id would otherwise silently
  // survive (and shadow the deletion in the editor).
  await db.diagrams.where("diagramId").equals(diagramId).delete();
  versions.delete(diagramId);
  await refreshPending();
}

// --- migration of pre-cloud local diagrams ------------------------------------

export async function countLocalDiagrams() {
  return db.diagrams.count();
}

// Uploads every local diagram, server-newer copies win (local loser is kept in
// the zip backup the caller downloads first). Returns {uploaded, skipped}.
export async function uploadLocalDiagrams() {
  const rows = await db.diagrams.toArray();
  let uploaded = 0;
  let skipped = 0;

  for (const row of rows) {
    // strip the Dexie auto-increment key; diagramId is the real identity
    // eslint-disable-next-line no-unused-vars
    const { id, ...payload } = row;
    const { diagramId, name, database, lastModified, content } =
      splitPayload(payload);

    const body = {
      name,
      database,
      content,
      baseVersion: versions.get(diagramId) ?? null,
      force: false,
    };

    try {
      const { data } = await putDiagram(diagramId, body);
      versions.set(diagramId, data.version);
      uploaded++;
    } catch (err) {
      if (err?.response?.status !== 409) throw err;
      const server = err.response.data;
      const localTime = new Date(lastModified).getTime();
      const serverTime = new Date(server.lastModified).getTime();
      if (localTime > serverTime) {
        const { data } = await putDiagram(diagramId, { ...body, force: true });
        versions.set(diagramId, data.version);
        uploaded++;
      } else {
        versions.set(diagramId, server.version);
        skipped++;
      }
    }
  }

  return { uploaded, skipped };
}

// --- background flushing ------------------------------------------------------

let wired = false;

export function wireBackgroundSync() {
  if (wired) return;
  wired = true;
  window.addEventListener("online", () => flushOutbox());
  window.addEventListener("focus", () => {
    if (state.pending > 0) flushOutbox();
  });
  setInterval(() => {
    if (state.pending > 0 && navigator.onLine) flushOutbox();
  }, 60_000);
  refreshPending();
}
