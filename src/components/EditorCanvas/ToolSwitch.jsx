import "../../styles/toolswitch.css";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useHotkeys } from "react-hotkeys-hook";
import { useLayout, useTool } from "../../hooks";
import { Tool } from "../../context/ToolContext";

/**
 * The tool island, top-centre of the canvas.
 *
 * A real mode switch rather than a row of "add" buttons: picking a tool arms
 * the canvas, and the next click on empty canvas places the object *there*
 * instead of at the middle of the viewport. The active tool is spelled out —
 * tinted pill, bold label, crosshair cursor — because a mode you cannot see is
 * a mode you get stuck in.
 *
 * Portalled to the body like the command palette so no canvas transform,
 * overflow or stacking context can clip or move it.
 */

const icons = {
  [Tool.SELECT]: <path d="M6 3v12.5l3-3 2.2 4.5 1.8-.8-2.2-4.4 3.8-.3z" />,
  [Tool.TABLE]: (
    <>
      <rect x="3.2" y="4.2" width="13.6" height="11.6" rx="2" />
      <path d="M3.2 8.1h13.6M8.4 8.1v7.7" />
    </>
  ),
  [Tool.RELATIONSHIP]: (
    <>
      <circle cx="5.6" cy="6" r="2.2" />
      <circle cx="14.4" cy="14" r="2.2" />
      <path d="M7.5 7.2 12.5 12.8" />
    </>
  ),
  [Tool.NOTE]: (
    <>
      <path d="M4 4.2h12v7.6L11.8 16H4z" />
      <path d="M16 11.8h-4.2V16" />
    </>
  ),
  [Tool.AREA]: (
    <rect
      x="3.5"
      y="4.5"
      width="13"
      height="11"
      rx="2"
      strokeDasharray="3 2.4"
    />
  ),
};

const tools = [
  { id: Tool.SELECT, shortcut: "V", label: "tool_select" },
  { id: Tool.TABLE, shortcut: "T", label: "tool_table" },
  { id: Tool.RELATIONSHIP, shortcut: "R", label: "tool_relationship" },
  { id: Tool.NOTE, shortcut: "N", label: "tool_note" },
  { id: Tool.AREA, shortcut: "A", label: "tool_area" },
];

export default function ToolSwitch() {
  const { t } = useTranslation();
  const { tool, setTool } = useTool();
  const { layout } = useLayout();

  // Nothing here can do anything useful in a read-only or chromeless embed.
  const visible = !layout.readOnly && layout.toolbar;

  // Single letters, so react-hotkeys-hook's default of ignoring input, textarea,
  // select and contenteditable targets is what keeps typing a table name from
  // switching tools. It also requires an exact modifier match, so mod+V (paste)
  // never reaches the select tool.
  const options = { enabled: visible };
  useHotkeys("v", () => setTool(Tool.SELECT), options);
  useHotkeys("t", () => setTool(Tool.TABLE), options);
  useHotkeys("r", () => setTool(Tool.RELATIONSHIP), options);
  useHotkeys("n", () => setTool(Tool.NOTE), options);
  useHotkeys("a", () => setTool(Tool.AREA), options);
  useHotkeys("escape", () => setTool(Tool.SELECT), options);

  if (!visible) return null;

  return createPortal(
    <div className="tool-switch" role="toolbar" aria-label={t("toolbar")}>
      {tools.map(({ id, shortcut, label }) => (
        <button
          key={id}
          type="button"
          className={`tsw-tool${tool === id ? " is-active" : ""}`}
          aria-pressed={tool === id}
          title={`${t(label)} — ${shortcut}`}
          onClick={() => setTool(id)}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {icons[id]}
          </svg>
          <span className="tsw-label">{t(label)}</span>
          <span className="tsw-key" aria-hidden="true">
            {shortcut}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
