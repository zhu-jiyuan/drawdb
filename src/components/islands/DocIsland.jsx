import { useTranslation } from "react-i18next";
import "../../styles/islands.css";

/**
 * The document island, top-left of the canvas.
 *
 * Replaces the full-width header bar: the approved design keeps the canvas
 * edge-to-edge and floats compact islands over it, so the diagram gets the
 * whole viewport instead of surrendering a strip to chrome.
 */
export default function DocIsland({
  title,
  state,
  saving,
  onRename,
  onMenu,
  onShare,
  showShare = true,
}) {
  const { t } = useTranslation();

  return (
    <div className="island doc">
      <div className="isl-logo" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round">
          <ellipse cx="10" cy="5.4" rx="6.2" ry="2.7" />
          <path d="M3.8 5.4v9.2c0 1.5 2.8 2.7 6.2 2.7s6.2-1.2 6.2-2.7V5.4M3.8 10c0 1.5 2.8 2.7 6.2 2.7s6.2-1.2 6.2-2.7" />
        </svg>
      </div>

      <button className="isl-meta" onClick={onRename} title={t("rename")}>
        <div className="isl-name">{title}</div>
        <div className="isl-state">
          <span className={`isl-dot${saving ? " busy" : ""}`} />
          {state}
        </div>
      </button>

      <div className="isl-vr" />

      <button className="isl-btn" onClick={onMenu} title={t("command_palette")}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
        </svg>
      </button>

      {showShare && (
        <button className="isl-share" onClick={onShare}>
          {t("share")}
        </button>
      )}
    </div>
  );
}
