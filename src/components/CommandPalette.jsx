import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { searchCommands } from "../utils/commandSearch";
import { shortcutKeys, IS_APPLE } from "../utils/commandRegistry";

const RECENTS_KEY = "drawdb.palette.recents";
const RECENTS_LIMIT = 6;

function readRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeRecents(ids) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, RECENTS_LIMIT)));
  } catch {
    // Private-mode storage failures must not break running a command.
  }
}

/** Splits a label into matched/unmatched runs so the query can be highlighted. */
function highlight(label, indices) {
  if (!indices || indices.length === 0) return [{ text: label, hit: false }];
  const set = new Set(indices);
  const parts = [];
  let current = "";
  let currentHit = set.has(0);
  for (let i = 0; i < label.length; i++) {
    const hit = set.has(i);
    if (hit !== currentHit) {
      if (current) parts.push({ text: current, hit: currentHit });
      current = "";
      currentHit = hit;
    }
    current += label[i];
  }
  if (current) parts.push({ text: current, hit: currentHit });
  return parts;
}

/**
 * ⌘K command palette. Commands come from ControlPanel's own menu object via
 * flattenMenu, so the palette reaches every action the menu bar reached without
 * a parallel list to maintain.
 */
export default function CommandPalette({ open, onClose, commands }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [confirming, setConfirming] = useState(null);
  const [recents, setRecents] = useState(readRecents);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Unavailable actions stay in the list, greyed. Filtering them out would mean
  // searching "undo" with an empty undo stack answers "no matching action",
  // which reads as "this editor has no undo" rather than "nothing to undo".
  // Empty query leads with recently used — the palette is most useful when it
  // remembers, and it is the only affordance replacing the menu bar.
  const results = useMemo(() => {
    if (!query.trim()) {
      const byId = new Map(commands.map((c) => [c.id, c]));
      const recent = recents
        .map((id) => byId.get(id))
        .filter((c) => c && !c.disabled);
      const recentIds = new Set(recent.map((c) => c.id));
      return [
        ...recent.map((command) => ({ command, indices: [], recent: true })),
        ...commands
          .filter((c) => !recentIds.has(c.id))
          .map((command) => ({ command, indices: [] })),
      ];
    }
    return searchCommands(commands, query);
  }, [commands, query, recents]);

  // Never open with an unusable row selected.
  const firstEnabled = useMemo(
    () => Math.max(0, results.findIndex((r) => !r.command.disabled)),
    [results],
  );
  // Read through a ref on open: depending on the value directly would re-run
  // the open effect whenever the first usable row moves, wiping the query
  // mid-typing.
  const firstEnabledRef = useRef(firstEnabled);
  firstEnabledRef.current = firstEnabled;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(firstEnabledRef.current);
    setConfirming(null);
    setRecents(readRecents());
    // Semi UI's dropdowns steal focus on mount; defer to win the race.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Reset the selection whenever the query changes. firstEnabled is a number,
  // so it only re-fires this when the first usable row actually moves — arrow
  // navigation does not disturb it.
  useEffect(() => {
    setActive(firstEnabled);
    setConfirming(null);
  }, [query, firstEnabled]);

  // Keep the highlighted row visible during keyboard navigation.
  useEffect(() => {
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  // Escape is handled on the input, which normally holds focus. Anything that
  // moves focus elsewhere would otherwise leave the palette unclosable, so back
  // it with a document-level listener.
  useEffect(() => {
    if (!open) return undefined;
    const onDocumentKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (confirming) setConfirming(null);
      else onClose();
    };
    document.addEventListener("keydown", onDocumentKey);
    return () => document.removeEventListener("keydown", onDocumentKey);
  }, [open, confirming, onClose]);

  const runCommand = useCallback(
    (entry) => {
      const command = entry?.command;
      if (!command || command.disabled) return;

      // Destructive actions confirm in place rather than opening a second
      // dialog on top of the palette.
      if (command.warning && confirming !== command.id) {
        setConfirming(command.id);
        return;
      }

      const next = [command.id, ...recents.filter((id) => id !== command.id)];
      writeRecents(next);
      setRecents(next);
      onClose();
      // Let the palette unmount before the action runs, so actions that open a
      // modal or move focus are not fighting a closing overlay.
      requestAnimationFrame(() => command.run());
    },
    [confirming, onClose, recents],
  );

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) =>
        results.length ? (i - 1 + results.length) % results.length : 0,
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, results.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runCommand(results[active]);
    }
    // Escape is deliberately absent: the document-level listener owns it, so it
    // works no matter where focus is and only ever fires once.
  };

  if (!open) return null;

  let lastGroup = null;

  return createPortal(
    <div
      className="palette-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={t("command_palette")}
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("command_palette_placeholder")}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={
            results[active] ? `palette-cmd-${results[active].command.id}` : undefined
          }
          autoComplete="off"
          spellCheck="false"
        />

        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.length === 0 && (
            <div className="palette-empty">{t("no_commands_found")}</div>
          )}

          {results.map((entry, index) => {
            const { command, indices } = entry;
            const groupLabel = entry.recent ? t("recently_used") : command.group;
            const showGroup = groupLabel !== lastGroup;
            lastGroup = groupLabel;
            const isActive = index === active;
            const isConfirming = confirming === command.id;
            const keys = shortcutKeys(command.shortcut, IS_APPLE);

            return (
              <div key={command.id}>
                {showGroup && <div className="palette-group">{groupLabel}</div>}
                <div
                  id={`palette-cmd-${command.id}`}
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  aria-disabled={command.disabled || undefined}
                  className={`palette-row${isActive ? " is-active" : ""}${
                    isConfirming ? " is-confirming" : ""
                  }${command.disabled ? " is-disabled" : ""}`}
                  onMouseMove={() => setActive(index)}
                  // Clicking a row must not pull focus out of the input, or the
                  // keyboard stops working mid-interaction — most visibly on a
                  // confirm step, where Enter and Escape are the only ways out.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runCommand(entry)}
                >
                  <span className="palette-label">
                    <span className="palette-text">
                      {highlight(command.label, indices).map((part, i) =>
                        part.hit ? (
                          <mark key={i} className="palette-hit">
                            {part.text}
                          </mark>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </span>
                    {command.hint && (
                      <span className="palette-hint">{command.hint}</span>
                    )}
                  </span>

                  {isConfirming ? (
                    <span className="palette-confirm">{t("press_enter_to_confirm")}</span>
                  ) : (
                    <span className="palette-trailing">
                      {command.state}
                      {keys.map((key) => (
                        <kbd key={key} className="palette-key">
                          {key}
                        </kbd>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
