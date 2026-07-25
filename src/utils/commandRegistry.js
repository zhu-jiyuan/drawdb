// Flattens ControlPanel's nested `menu` object into the flat command list the
// palette searches.
//
// The list is derived rather than hand-written on purpose. `menu` is already a
// registry — its keys are i18n keys and its leaves carry `function`, `shortcut`,
// `disabled`, `warning` and `state` — so deriving from it means a command can
// never drift from the menu entry it came from, and an action added to `menu`
// shows up in the palette with no second edit.

// Actions worth surfacing above an equally-good text match. Adding a table is
// the most-used action in the editor and would otherwise lose the query "table"
// to "Table width" on position alone; see searchCommands.
const WEIGHTS = {
  "edit.undo": 1.3,
  "edit.redo": 1.3,
  "file.save": 1.25,
  "file.open": 1.2,
  "edit.delete": 1.1,
};

// Extra search terms for commands whose label does not contain the word people
// actually type. Keyed by command id, matched against on top of the label.
const KEYWORDS = {
  "file.new": "create blank diagram",
  "file.open": "recent diagrams list",
  "file.export_as": "download image picture",
  "file.export_source": "sql ddl download schema",
  "file.import_from": "load upload",
  "edit.copy_as_image": "clipboard png",
  "view.dbml_view": "code editor",
  "view.presentation_mode": "fullscreen present",
  "settings.table_width": "size resize card",
  "settings.language": "locale translate i18n",
  "view.theme": "dark light appearance",
  "view.zoom_in": "magnify bigger",
  "view.zoom_out": "shrink smaller",
};

export const IS_APPLE =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");

/** A child entry that only labels state (dividers, empty placeholders). */
function isRunnableChild(child) {
  return !!child && !child.divider && typeof child.function === "function";
}

/**
 * @param menu the nested object from ControlPanel
 * @param t i18next translator — menu keys are i18n keys
 * @returns flat array of { id, group, label, keywords, shortcut, disabled,
 *          state, warning, run }
 */
export function flattenMenu(menu, t) {
  const commands = [];

  for (const [sectionKey, section] of Object.entries(menu ?? {})) {
    const sectionLabel = t(sectionKey);
    // Direct actions first, submenu children after. Interleaving them the way
    // the menu declares them splits a section into "File / File › Open recent /
    // File" — the same heading twice with a sub-group wedged between.
    const direct = [];
    const nested = [];

    for (const [entryKey, entry] of Object.entries(section ?? {})) {
      if (!entry) continue;
      const id = `${sectionKey}.${entryKey}`;
      const entryLabel = t(entryKey);

      // A submenu contributes its children, not itself — "Export as" is not
      // something you can run, but "Export as > PNG" is.
      if (Array.isArray(entry.children) && entry.children.length > 0) {
        const runnable = entry.children.filter(isRunnableChild);
        for (const child of runnable) {
          // Children carry a display `name`; `label` is a subtitle when present
          // (open_recent uses it for the relative timestamp).
          const childName = child.name ?? child.title ?? "";
          if (!childName) continue;
          nested.push({
            id: `${id}.${String(childName).toLowerCase().replace(/\s+/g, "_")}`,
            group: `${sectionLabel} › ${entryLabel}`,
            label: String(childName),
            hint: child.label ? String(child.label) : undefined,
            keywords: [KEYWORDS[id], entryLabel].filter(Boolean).join(" "),
            shortcut: child.shortcut,
            disabled: !!child.disabled,
            state: child.state,
            warning: child.warning,
            run: child.function,
          });
        }
        // Some entries have children AND a placeholder function (open_recent);
        // the placeholder is not a real action, so it is dropped.
        continue;
      }

      if (typeof entry.function !== "function") continue;

      direct.push({
        id,
        group: sectionLabel,
        label: entryLabel,
        keywords: KEYWORDS[id],
        shortcut: entry.shortcut,
        disabled: !!entry.disabled,
        state: entry.state,
        warning: entry.warning,
        weight: WEIGHTS[id],
        run: entry.function,
      });
    }

    commands.push(...direct, ...nested);
  }

  return commands;
}

/**
 * Normalizes the `shortcut` strings menu entries use ("Ctrl+Shift+S") into
 * per-key tokens, with Ctrl shown as ⌘ on Apple platforms to match what the
 * hotkey layer actually binds.
 */
export function shortcutKeys(shortcut, isApple) {
  if (!shortcut) return [];
  return String(shortcut)
    .split("+")
    .map((raw) => {
      const key = raw.trim();
      if (!isApple) return key;
      if (/^ctrl$/i.test(key)) return "⌘";
      if (/^shift$/i.test(key)) return "⇧";
      if (/^alt$/i.test(key)) return "⌥";
      return key;
    })
    .filter(Boolean);
}
