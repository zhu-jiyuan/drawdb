import { useDiagram, useSelect } from "../../../hooks";
import { ObjectType } from "../../../data/constants";
import EntitySearchBar from "../EntitySearchBar";

const labelOf = (relationship) => relationship.name;

export default function SearchBar() {
  const { relationships } = useDiagram();
  const { setSelectedElement } = useSelect();

  return (
    <EntitySearchBar
      items={relationships}
      labelOf={labelOf}
      scrollIdOf={(relationship) => `scroll_ref_${relationship.id}`}
      onPick={(relationship) =>
        setSelectedElement((prev) => ({
          ...prev,
          id: relationship.id,
          open: true,
          element: ObjectType.RELATIONSHIP,
        }))
      }
    />
  );
}
