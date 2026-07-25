import { useMemo, useState } from "react";
import { AutoComplete } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";

/**
 * Search box over one kind of diagram entity.
 *
 * Replaces five near-identical copies (types, relationships, notes, areas,
 * enums) that each snapshotted their option list with
 * `useState(items.map(...))` and only recomputed it inside the search handler —
 * so adding an entity and opening the dropdown without typing showed a list
 * that predated it. Deriving the options from `items` makes that impossible.
 *
 * @param items      entities to search
 * @param labelOf    entity -> the text shown and matched (name, or title)
 * @param scrollIdOf entity -> DOM id to scroll into view, or null to skip
 * @param onPick     called with the chosen entity, before scrolling
 */
export default function EntitySearchBar({
  items,
  labelOf,
  scrollIdOf,
  onPick,
}) {
  const [query, setQuery] = useState("");
  const { t } = useTranslation();

  const options = useMemo(
    () =>
      (items ?? [])
        .map(labelOf)
        .filter((label) => typeof label === "string" && label.includes(query)),
    [items, labelOf, query],
  );

  return (
    <AutoComplete
      data={options}
      value={query}
      showClear
      prefix={<IconSearch />}
      placeholder={t("search")}
      onSearch={setQuery}
      emptyContent={<div className="p-3 popover-theme">{t("not_found")}</div>}
      onChange={setQuery}
      onSelect={(label) => {
        const item = (items ?? []).find((entity) => labelOf(entity) === label);
        if (!item) return;
        onPick?.(item);
        // The lists are not mounted while the inspector is showing a selection,
        // so the scroll target can legitimately be absent. Every copy of this
        // dereferenced it unguarded.
        const id = scrollIdOf?.(item);
        if (!id) return;
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: "smooth" });
      }}
      className="w-full"
    />
  );
}
