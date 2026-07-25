import { useSelect, useTypes } from "../../../hooks";
import { ObjectType } from "../../../data/constants";
import EntitySearchBar from "../EntitySearchBar";

const labelOf = (type) => type.name;

export default function SearchBar() {
  const { types } = useTypes();
  const { setSelectedElement } = useSelect();

  return (
    <EntitySearchBar
      items={types}
      labelOf={labelOf}
      scrollIdOf={(type) => `scroll_type_${types.indexOf(type)}`}
      onPick={(type) =>
        setSelectedElement((prev) => ({
          ...prev,
          id: types.indexOf(type),
          open: true,
          element: ObjectType.TYPE,
        }))
      }
    />
  );
}
