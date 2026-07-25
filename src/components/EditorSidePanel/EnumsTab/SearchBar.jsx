import { useEnums } from "../../../hooks";
import EntitySearchBar from "../EntitySearchBar";

const labelOf = (item) => item.name;

export default function SearchBar() {
  const { enums } = useEnums();

  return (
    <EntitySearchBar
      items={enums}
      labelOf={labelOf}
      scrollIdOf={(item) => `scroll_enum_${item.id}`}
    />
  );
}
