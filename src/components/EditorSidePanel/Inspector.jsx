import { IconArrowLeft } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import { ObjectType } from "../../data/constants";
import { useSelect, useDiagram, useAreas, useNotes } from "../../hooks";
import TableInfo from "./TablesTab/TableInfo";
import RelationshipInfo from "./RelationshipsTab/RelationshipInfo";
import AreaInfo from "./AreasTab/AreaDetails";
import NoteInfo from "./NotesTab/NoteInfo";

/**
 * Properties of whatever is selected on the canvas.
 *
 * Before this, editing a table meant knowing to open the side panel, pick the
 * Tables tab, find the row and expand it — the object in front of you and the
 * controls for it were in different places, reached by different routes. The
 * panel now follows the selection, so clicking a table on the canvas is the
 * only step.
 *
 * It also collapses a per-object SideSheet that Table.jsx and Relationship.jsx
 * each rendered, one instance per object on the diagram.
 */
export default function Inspector() {
  const { t } = useTranslation();
  const { selectedElement, setSelectedElement } = useSelect();
  const { tables, relationships } = useDiagram();
  const { areas } = useAreas();
  const { notes } = useNotes();

  const { element, id } = selectedElement;

  const clearSelection = () =>
    setSelectedElement((prev) => ({
      ...prev,
      element: ObjectType.NONE,
      id: -1,
      open: false,
    }));

  let title = null;
  let kind = null;
  let body = null;

  if (element === ObjectType.TABLE) {
    const table = tables.find((x) => x.id === id);
    if (table) {
      title = table.name;
      kind = t("table");
      body = <TableInfo data={table} />;
    }
  } else if (element === ObjectType.RELATIONSHIP) {
    const relationship = relationships.find((x) => x.id === id);
    if (relationship) {
      title = relationship.name;
      kind = t("relationship");
      body = <RelationshipInfo data={relationship} />;
    }
  } else if (element === ObjectType.AREA) {
    const index = areas.findIndex((x) => x.id === id);
    if (index !== -1) {
      title = areas[index].name;
      kind = t("subject_area");
      body = <AreaInfo data={areas[index]} i={index} />;
    }
  } else if (element === ObjectType.NOTE) {
    const index = notes.findIndex((x) => x.id === id);
    if (index !== -1) {
      title = notes[index].title;
      kind = t("note");
      body = <NoteInfo data={notes[index]} nid={index} />;
    }
  }

  // The selection can name something that no longer exists — deleting the
  // selected table leaves the id behind for a render.
  if (!body) return null;

  return (
    <div className="inspector">
      <div className="inspector-head">
        <button
          className="inspector-back"
          onClick={clearSelection}
          title={t("back_to_lists")}
          aria-label={t("back_to_lists")}
        >
          <IconArrowLeft />
        </button>
        <div className="inspector-title">
          <div className="inspector-name" title={title}>
            {title}
          </div>
          <div className="inspector-kind">{kind}</div>
        </div>
      </div>
      <div className="inspector-body">{body}</div>
    </div>
  );
}
