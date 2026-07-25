import { useAreas } from "../../../hooks";
import EntitySearchBar from "../EntitySearchBar";

const labelOf = (area) => area.name;

export default function SearchBar() {
  const { areas } = useAreas();

  return (
    <EntitySearchBar
      items={areas}
      labelOf={labelOf}
      scrollIdOf={(area) => `scroll_area_${area.id}`}
    />
  );
}
