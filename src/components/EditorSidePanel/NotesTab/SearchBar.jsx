import { useNotes, useSelect } from "../../../hooks";
import { ObjectType } from "../../../data/constants";
import EntitySearchBar from "../EntitySearchBar";

const labelOf = (note) => note.title;

export default function SearchBar() {
  const { notes } = useNotes();
  const { setSelectedElement } = useSelect();

  return (
    <EntitySearchBar
      items={notes}
      labelOf={labelOf}
      scrollIdOf={(note) => `scroll_note_${note.id}`}
      onPick={(note) =>
        // `open` and `element` were both missing here, so picking a note
        // scrolled to a panel it never expanded.
        setSelectedElement((prev) => ({
          ...prev,
          id: note.id,
          open: true,
          element: ObjectType.NOTE,
        }))
      }
    />
  );
}
