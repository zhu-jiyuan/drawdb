import { useTranslation } from "react-i18next";
import { useTransform } from "../../hooks";
import "../../styles/islands.css";

/**
 * Zoom and history island, bottom-left of the canvas.
 *
 * The design gives these their own island rather than burying them in a wide
 * toolbar — they are the two controls reached most often while reading a
 * diagram, and they were the ones falling off the right edge on a phone.
 */
export default function ZoomIsland({ onUndo, onRedo, canUndo, canRedo, onResetZoom }) {
  const { t } = useTranslation();
  const { transform, setTransform } = useTransform();

  const zoomBy = (factor) =>
    setTransform((prev) => ({ ...prev, zoom: prev.zoom * factor }));

  return (
    <div className="island zoom">
      <button className="isl-btn" onClick={() => zoomBy(1 / 1.2)} title={t("zoom_out")}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <path d="M4.5 10h11" />
        </svg>
      </button>

      <button className="isl-zlevel" onClick={onResetZoom} title={t("reset_view")}>
        {Math.round(transform.zoom * 100)}%
      </button>

      <button className="isl-btn" onClick={() => zoomBy(1.2)} title={t("zoom_in")}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <path d="M4.5 10h11M10 4.5v11" />
        </svg>
      </button>

      <div className="isl-vr" />

      <button className="isl-btn" onClick={onUndo} disabled={!canUndo} title={t("undo")}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 5 3 9l4 4" />
          <path d="M3 9h8.5A4.5 4.5 0 0 1 16 13.5v1" />
        </svg>
      </button>

      <button className="isl-btn" onClick={onRedo} disabled={!canRedo} title={t("redo")}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 5l4 4-4 4" />
          <path d="M17 9H8.5A4.5 4.5 0 0 0 4 13.5v1" />
        </svg>
      </button>
    </div>
  );
}
