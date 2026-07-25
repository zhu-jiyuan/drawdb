import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import { ObjectType } from "../../data/constants";
import { useLayout, useSelect } from "../../hooks";
import Inspector from "./Inspector";

const PHONE = "(max-width: 700px)";

function useIsPhone() {
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(PHONE).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(PHONE);
    const onChange = (e) => setIsPhone(e.matches);
    mq.addEventListener("change", onChange);
    setIsPhone(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isPhone;
}

/**
 * The inspector as a bottom sheet, for phones.
 *
 * A 374px side panel on a 390px screen is not a side panel — it is the whole
 * screen — so phones start with the sidebar collapsed. That left them with no
 * home for the selection inspector, and therefore no way to reach a table's
 * comment, indices or field details at all. A sheet over the lower half keeps
 * the canvas and the selected card visible while editing it.
 */
export default function MobileInspector() {
  const isPhone = useIsPhone();
  const { layout } = useLayout();
  const { selectedElement, setSelectedElement } = useSelect();
  const { t } = useTranslation();

  const hasSelection =
    selectedElement.element !== ObjectType.NONE && selectedElement.id !== -1;

  // When the side panel is open it already shows the inspector; two would be a
  // duplicate of the same form.
  if (!isPhone || layout.sidebar || !hasSelection) return null;

  return createPortal(
    <div className="mobile-inspector" role="dialog" aria-label={t("edit")}>
      <button
        className="mobile-inspector-grip"
        onClick={() =>
          setSelectedElement((prev) => ({
            ...prev,
            element: ObjectType.NONE,
            id: -1,
            open: false,
          }))
        }
        aria-label={t("back_to_lists")}
      >
        <IconChevronDown />
      </button>
      <Inspector />
    </div>,
    document.body,
  );
}
