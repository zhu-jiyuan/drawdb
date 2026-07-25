import "../../styles/card.css";
import { useMemo, useState } from "react";
import {
  Action,
  Tab,
  ObjectType,
  tableHeaderHeight,
  tableColorStripHeight,
  typeInk,
} from "../../data/constants";
import {
  IconChevronDown,
  IconChevronUp,
  IconMore,
  IconDeleteStroked,
  IconEditStroked,
  IconCopyStroked,
  IconLock,
  IconUnlock,
} from "@douyinfe/semi-icons";
import { nanoid } from "nanoid";
import {
  Popover,
  Tag,
  Button,
  ButtonGroup,
  Divider,
  Select,
} from "@douyinfe/semi-ui";
import {
  useLayout,
  useSettings,
  useDiagram,
  useSelect,
  useUndoRedo,
  useTypes,
  useEnums,
  useTransform,
  useFontsReady,
} from "../../hooks";
import { useTranslation } from "react-i18next";
import { getCustomTypesForDb, resolveType } from "../../utils/customTypes";
import { fieldUpdatesForTypeChange } from "../../utils/fieldTypeChange";
import { getRequiredTableWidth } from "../../utils/tableWidth";
import {
  roughCard,
  roughFill,
  roughRule,
  seedFrom,
} from "../../utils/roughShapes";
import { dbToTypes } from "../../data/datatypes";
import { isRtl } from "../../i18n/utils/rtl";
import i18n from "../../i18n/i18n";
import {
  getCommentHeight,
  getFieldHeight,
  getFieldOffsetY,
  getTableHeight,
  getVisibleFieldEntries,
  getVisibleFields,
  getRelationshipFields,
} from "../../utils/utils";

// Excalidraw-style cards: a colored stroke with a pastel wash of the same hue,
// instead of a heavy solid header bar.
function tint(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return `rgba(105, 101, 219, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export default function Table({
  tableData,
  onPointerDown,
  setHoveredTable,
  handleGripField,
  setLinkingLine,
}) {
  const [hoveredField, setHoveredField] = useState(null);
  // In-place editing on the canvas: table title / a field's name or type
  const [editingName, setEditingName] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState(null);
  const [editingTypeFieldId, setEditingTypeFieldId] = useState(null);
  const { layout, setLayout } = useLayout();
  const {
    database,
    tables,
    relationships,
    addTable,
    deleteTable,
    deleteField,
    updateTable,
    updateField,
  } = useDiagram();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { types } = useTypes();
  const { enums } = useEnums();
  const { settings, setSettings } = useSettings();
  const { transform } = useTransform();
  const { t } = useTranslation();
  const {
    selectedElement,
    setSelectedElement,
    bulkSelectedElements,
    setBulkSelectedElements,
  } = useSelect();

  // Cards size themselves to their content: settings.tableWidth is the floor
  // (raised by the resize handle), and a table grows past it rather than
  // truncating a field name or type.

  // Cards size themselves to their content: settings.tableWidth is the floor
  // (raised by the resize handle), and a table grows past it rather than
  // truncating a field name or type.
  const fontsTick = useFontsReady();
  const seed = useMemo(() => seedFrom(tableData.id), [tableData.id]);

  const cardWidth = useMemo(
    () => getRequiredTableWidth(tableData, database, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableData, database, settings, fontsTick],
  );

  const height = getTableHeight(
    tableData,
    cardWidth,
    settings.showComments,
    relationships,
  );

  const visibleFieldEntries = useMemo(
    () => getVisibleFieldEntries(tableData, relationships),
    [tableData, relationships],
  );

  // Y positions for the hand-drawn rules: under the header, then between rows.
  const rowSeparatorYs = useMemo(() => {
    if (!settings.sketchMode) return [];
    const ys = [];
    let y =
      tableHeaderHeight +
      getCommentHeight(tableData.comment, cardWidth, settings.showComments);
    ys.push(y);
    for (let i = 0; i < visibleFieldEntries.length - 1; i++) {
      y += getFieldHeight(
        visibleFieldEntries[i].field,
        cardWidth,
        settings.showComments,
      );
      ys.push(y);
    }
    return ys;
  }, [
    settings.sketchMode,
    settings.showComments,
    tableData.comment,
    cardWidth,
    visibleFieldEntries,
  ]);

  const visibleFields = useMemo(
    () => getVisibleFields(tableData, relationships),
    [tableData, relationships],
  );


  const isSelected = useMemo(() => {
    return (
      (selectedElement.id == tableData.id &&
        selectedElement.element === ObjectType.TABLE) ||
      bulkSelectedElements.some(
        (e) => e.type === ObjectType.TABLE && e.id === tableData.id,
      )
    );
  }, [selectedElement, tableData, bulkSelectedElements]);

  const toggleTableCollapse = (e) => {
    e.stopPropagation();
    if (layout.readOnly) return;

    const collapsed = !tableData.collapsed;
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.TABLE,
        component: "self",
        tid: tableData.id,
        undo: { collapsed: tableData.collapsed },
        redo: { collapsed },
        message: t("edit_table", {
          tableName: tableData.name,
          extra: "[collapse fields]",
        }),
      },
    ]);
    setRedoStack([]);
    updateTable(tableData.id, { collapsed });
  };

  const lockUnlockTable = (e) => {
    const locking = !tableData.locked;
    updateTable(tableData.id, { locked: locking });

    const lockTable = () => {
      setSelectedElement({
        ...selectedElement,
        element: ObjectType.NONE,
        id: -1,
        open: false,
      });
      setBulkSelectedElements((prev) =>
        prev.filter(
          (el) => el.id !== tableData.id || el.type !== ObjectType.TABLE,
        ),
      );
    };

    const unlockTable = () => {
      const elementInBulk = {
        id: tableData.id,
        type: ObjectType.TABLE,
        initialCoords: { x: tableData.x, y: tableData.y },
        currentCoords: { x: tableData.x, y: tableData.y },
      };
      if (e.ctrlKey || e.metaKey) {
        setBulkSelectedElements((prev) => [...prev, elementInBulk]);
      } else {
        setBulkSelectedElements([elementInBulk]);
      }
      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.TABLE,
        id: tableData.id,
        open: false,
      }));
    };

    if (locking) {
      lockTable();
    } else {
      unlockTable();
    }
  };

  const duplicateTable = () => {
    if (layout.readOnly) return;
    const duplicated = {
      ...tableData,
      id: nanoid(),
      name: `${tableData.name}_copy`,
      // Clear the original instead of overlapping it (cards are >=180px wide).
      x: tableData.x + cardWidth + 40,
      y: tableData.y,
      fields: tableData.fields.map((f) => ({ ...f, id: nanoid() })),
      indices: tableData.indices.map((idx) => ({ ...idx, id: nanoid() })),
    };
    addTable({ table: duplicated });
  };

  const commitTableName = (value) => {
    setEditingName(false);
    const name = value.trim();
    if (!name || name === tableData.name) return;
    const oldName = tableData.name;
    updateTable(tableData.id, { name });
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.TABLE,
        component: "self",
        tid: tableData.id,
        undo: { name: oldName },
        redo: { name },
        message: t("edit_table", { tableName: name, extra: "[name]" }),
      },
    ]);
    setRedoStack([]);
  };

  const commitFieldName = (fieldData, value) => {
    setEditingFieldId(null);
    const name = value.trim();
    if (!name || name === fieldData.name) return;
    const oldName = fieldData.name;
    updateField(tableData.id, fieldData.id, { name });
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.TABLE,
        component: "field",
        tid: tableData.id,
        fid: fieldData.id,
        undo: { name: oldName },
        redo: { name },
        message: t("edit_table", { tableName: tableData.name, extra: "[field]" }),
      },
    ]);
    setRedoStack([]);
  };

  // Drag the right edge to resize table width. Width is a global setting in
  // drawdb (relationship geometry assumes one width), so every table resizes
  // together — the handle just makes it directly adjustable from the canvas.
  const startWidthResize = (e) => {
    if (layout.readOnly) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = settings.tableWidth;
    const zoom = transform.zoom || 1;
    const onMove = (ev) => {
      const next = Math.round(startWidth + (ev.clientX - startX) / zoom);
      setSettings((prev) => ({
        ...prev,
        tableWidth: Math.min(520, Math.max(180, next)),
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Same option list as the side panel's type Select.
  const typeOptions = [
    ...Object.keys(dbToTypes[database]),
    ...Object.keys(getCustomTypesForDb(database)),
    ...types.map((x) => x.name.toUpperCase()),
    ...enums.map((x) => x.name.toUpperCase()),
  ];

  const commitFieldType = (fieldData, value) => {
    setEditingTypeFieldId(null);
    if (!value || value === fieldData.type) return;
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.TABLE,
        component: "field",
        tid: tableData.id,
        fid: fieldData.id,
        undo: { type: fieldData.type },
        redo: { type: value },
        message: t("edit_table", { tableName: tableData.name, extra: "[field]" }),
      },
    ]);
    setRedoStack([]);
    updateField(
      tableData.id,
      fieldData.id,
      fieldUpdatesForTypeChange(database, fieldData, value),
    );
  };

  // Shared props for the in-place inputs: keep pointer/dblclick events from
  // dragging the table or bubbling up to the sheet-opening handler.
  const inlineInputProps = (commit, cancel) => ({
    autoFocus: true,
    onPointerDown: (e) => e.stopPropagation(),
    onDoubleClick: (e) => e.stopPropagation(),
    onClick: (e) => e.stopPropagation(),
    onBlur: (e) => commit(e.target.value),
    onKeyDown: (e) => {
      if (e.key === "Enter") e.target.blur();
      if (e.key === "Escape") cancel();
    },
  });

  // Selecting the table is enough to edit it: the side panel is an inspector
  // that follows the selection. If the panel is hidden there is nowhere for the
  // properties to appear, so show it rather than leaving the click inert.
  const openEditor = () => {
    setSelectedElement((prev) => ({
      ...prev,
      currentTab: Tab.TABLES,
      element: ObjectType.TABLE,
      id: tableData.id,
      open: true,
    }));
    if (!layout.sidebar) setLayout((prev) => ({ ...prev, sidebar: true }));
  };

  const getFieldReference = (fieldData) => {
    let matchedEndFieldId = null;
    const rel = relationships.find((r) => {
      if (r.startTableId !== tableData.id) return false;
      const pair = getRelationshipFields(r).find(
        (p) => p.startFieldId === fieldData.id,
      );
      if (!pair) return false;
      matchedEndFieldId = pair.endFieldId;
      return true;
    });
    if (!rel) return null;

    const refTable = tables.find((tbl) => tbl.id === rel.endTableId);
    const refField = refTable?.fields.find((f) => f.id === matchedEndFieldId);
    if (!refTable || !refField) return null;

    return { tableName: refTable.name, fieldName: refField.name };
  };

  if (tableData.hidden) return null;

  return (
    <>
      <g className="group" onPointerDown={onPointerDown}>
      {settings.sketchMode && (
        <g
          transform={`translate(${tableData.x}, ${tableData.y})`}
          className="pointer-events-none"
        >
          {/* paper */}
          {roughFill(cardWidth, height, seed).map((d, i) => (
            <path
              key={`bg${i}`}
              d={d}
              fill={settings.mode === "light" ? "#fdfdff" : "#27272a"}
              stroke="none"
            />
          ))}
          {/* header wash in the table's own hue */}
          {roughFill(cardWidth, tableHeaderHeight, seed + 1).map((d, i) => (
            <path
              key={`hd${i}`}
              d={d}
              fill={tint(tableData.color, settings.mode === "light" ? 0.16 : 0.3)}
              stroke="none"
            />
          ))}
          {/* header underline + row separators */}
          {rowSeparatorYs.map((y, i) =>
            roughRule(6, y, cardWidth - 6, seed + 2 + i).map((d, j) => (
              <path
                key={`sep${i}-${j}`}
                d={d}
                fill="none"
                stroke={tint(tableData.color, 0.5)}
                strokeWidth={1}
                strokeLinecap="round"
              />
            )),
          )}
          {/* outline, drawn twice like a pencil pass */}
          {roughCard(cardWidth, height, seed).map((d, i) => (
            <path
              key={`ol${i}`}
              d={d}
              fill="none"
              stroke={isSelected ? "#6965db" : tableData.color}
              strokeWidth={isSelected ? 2 : 1.3}
              strokeLinecap="round"
            />
          ))}
        </g>
      )}
      <foreignObject
        key={tableData.id}
        x={tableData.x}
        y={tableData.y}
        width={cardWidth}
        height={height}
        className={`${settings.sketchMode ? "" : "drop-shadow-lg"} rounded-md cursor-move`}
      >
        <div
          onDoubleClick={openEditor}
          className={`relative select-none rounded-lg w-full ${
            settings.sketchMode ? "border-0" : "border-2"
          } ${settings.mode === "light" ? "text-zinc-800" : "text-zinc-200"}`}
          style={{
            direction: "ltr",
            borderColor: isSelected ? "#6965db" : tableData.color,
            backgroundColor: settings.sketchMode
              ? "transparent"
              : settings.mode === "light"
                ? tint(tableData.color, 0.05)
                : "rgb(39 39 42)",
          }}
        >
          {!layout.readOnly && (
            <div
              className="absolute top-0 right-0 z-10 h-full w-[14px] flex justify-end cursor-ew-resize touch-none"
              title={t("table_width")}
              onDoubleClick={(e) => e.stopPropagation()}
              onPointerDown={startWidthResize}
            >
              {/* Always-visible thin violet bar so the resize affordance is
                  discoverable (and touch has no hover); thickens on hover. */}
              <div className="h-full w-[3px] bg-[#6965db]/30 group-hover:bg-[#6965db]/70 group-hover:w-[4px]" />
            </div>
          )}
          {!settings.sketchMode && (
            <div
              className="h-[6px] w-full rounded-t-md"
              style={{ backgroundColor: tableData.color }}
            />
          )}
          <div
            className={`${visibleFieldEntries.length === 0 ? "rounded-b-md" : ""} ${
              tableData.comment && settings.showComments ? "pb-3" : ""
            }`}
            style={
              settings.sketchMode
                ? undefined
                : {
                    backgroundColor: tint(
                      tableData.color,
                      settings.mode === "light" ? 0.14 : 0.28,
                    ),
                    borderBottom:
                      visibleFieldEntries.length === 0
                        ? "none"
                        : `1px solid ${tint(tableData.color, 0.45)}`,
                  }
            }
          >
            <div
              className={`table-title overflow-hidden font-bold h-[46px] flex justify-between items-center gap-2`}
            >
              <div
                className="px-3 whitespace-nowrap overflow-hidden text-ellipsis min-w-0 flex-1 cursor-text"
                onClick={(e) => {
                  if (layout.readOnly) return;
                  e.stopPropagation();
                  setEditingName(true);
                }}
              >
                {editingName ? (
                  <input
                    defaultValue={tableData.name}
                    className="w-full bg-transparent border border-blue-400 rounded px-1 outline-none font-bold"
                    {...inlineInputProps(commitTableName, () =>
                      setEditingName(false),
                    )}
                  />
                ) : (
                  <>
                    {tableData.name}
                    {/* Optional display name, e.g. `users 用户`. Edited from the
                        inspector; absent on most tables. */}
                    {tableData.alias ? (
                      <span className="table-alias">{tableData.alias}</span>
                    ) : null}
                  </>
                )}
              </div>
              <div className="hidden group-hover:flex items-center shrink-0 pe-2">
                <ButtonGroup
                  type="tertiary"
                  size="small"
                  aria-label="Table actions"
                >
                  <Button
                    size="small"
                    type="tertiary"
                    title={tableData.locked ? "Unlock table" : "Lock table"}
                    icon={
                      tableData.locked ? (
                        <IconLock size="small" />
                      ) : (
                        <IconUnlock size="small" />
                      )
                    }
                    disabled={layout.readOnly}
                    onClick={lockUnlockTable}
                  />
                  <Button
                    size="small"
                    type="tertiary"
                    icon={
                      tableData.collapsed ? (
                        <IconChevronDown size="small" />
                      ) : (
                        <IconChevronUp size="small" />
                      )
                    }
                    disabled={layout.readOnly}
                    aria-label={
                      tableData.collapsed
                        ? "Expand unlinked fields"
                        : "Collapse unlinked fields"
                    }
                    title={
                      tableData.collapsed
                        ? "Expand unlinked fields"
                        : "Collapse unlinked fields"
                    }
                    onClick={toggleTableCollapse}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                  <Popover
                    key={tableData.id}
                    content={
                      <div className="popover-theme flex flex-col py-1 min-w-[160px]">
                        <Button
                          icon={<IconEditStroked />}
                          type="tertiary"
                          theme="borderless"
                          block
                          style={{ justifyContent: "flex-start" }}
                          onClick={openEditor}
                        >
                          {t("edit")}
                        </Button>
                        <Button
                          icon={<IconCopyStroked />}
                          type="tertiary"
                          theme="borderless"
                          block
                          style={{ justifyContent: "flex-start" }}
                          onClick={duplicateTable}
                          disabled={layout.readOnly}
                        >
                          {t("duplicate")}
                        </Button>
                        <Divider className="!my-1" />
                        <Button
                          icon={<IconDeleteStroked />}
                          type="danger"
                          theme="borderless"
                          block
                          style={{ justifyContent: "flex-start" }}
                          onClick={() => deleteTable(tableData.id)}
                          disabled={layout.readOnly}
                        >
                          {t("delete")}
                        </Button>
                      </div>
                    }
                    position="rightTop"
                    style={{ padding: 8 }}
                    showArrow
                    trigger="click"
                  >
                    <Button
                      size="small"
                      type="tertiary"
                      icon={<IconMore size="small" />}
                      title="See more"
                    />
                  </Popover>
                </ButtonGroup>
              </div>
            </div>
            {tableData.comment && settings.showComments && (
              <div className="text-xs px-3 line-clamp-5">
                {tableData.comment}
              </div>
            )}
          </div>

          {visibleFieldEntries.map(({ field: e }, i) => {
            const resolved = resolveType(database, e.type);
            const reference = getFieldReference(e);
            // Suppress the hover summary popover while inline-editing this
            // field — otherwise it lingers open (focus leaves the row into the
            // portal) and its z-index fights the type dropdown.
            const isEditingThis =
              editingFieldId === e.id || editingTypeFieldId === e.id;
            return settings.showFieldSummary && !isEditingThis ? (
              <Popover
                key={e.id ?? i}
                content={
                  <div className="popover-theme">
                    <div
                      className="flex justify-between items-center pb-2"
                      style={{ direction: "ltr" }}
                    >
                      <p className="me-4 font-bold">{e.name}</p>
                      <p
                        className="ms-4 rounded-md px-2 py-[1px] text-[13px]"
                        style={{
                          backgroundColor: tint(resolved.color, 0.16),
                          color:
                            typeInk[String(resolved.color).toLowerCase()] ??
                            resolved.color,
                        }}
                      >
                        {e.type +
                          ((resolved.isSized || resolved.hasPrecision) &&
                          e.size &&
                          e.size !== ""
                            ? "(" + e.size + ")"
                            : "")}
                      </p>
                    </div>
                    <hr />
                    {e.primary && (
                      <Tag color="blue" className="me-2 my-2">
                        {t("primary_key")}
                      </Tag>
                    )}
                    {e.unique && (
                      <Tag color="amber" className="me-2 my-2">
                        {t("unique")}
                      </Tag>
                    )}
                    {e.notNull && (
                      <Tag color="purple" className="me-2 my-2">
                        {t("not_null")}
                      </Tag>
                    )}
                    {e.increment && (
                      <Tag color="green" className="me-2 my-2">
                        {t("autoincrement")}
                      </Tag>
                    )}
                    {reference && (
                      <Tag color="light-blue" className="me-2 my-2">
                        {t("foreign_key")}
                      </Tag>
                    )}
                    {reference && (
                      <p>
                        <strong>{t("references")}: </strong>
                        {reference.tableName}({reference.fieldName})
                      </p>
                    )}
                    <p>
                      <strong>{t("default_value")}: </strong>
                      {e.default === "" ? t("not_set") : e.default}
                    </p>
                    <p className="max-w-80">
                      <strong>{t("comment")}: </strong>
                      {e.comment === "" ? t("not_set") : e.comment}
                    </p>
                  </div>
                }
                position="right"
                showArrow
                style={
                  isRtl(i18n.language)
                    ? { direction: "rtl" }
                    : { direction: "ltr" }
                }
              >
                {field(e, i)}
              </Popover>
            ) : (
              field(e, i)
            );
          })}
        </div>
      </foreignObject>
      </g>
    </>
  );

  function field(fieldData, index) {
    const fieldResolved = resolveType(database, fieldData.type);
    const showFieldComment = fieldData.comment && settings.showComments;
    // One badge per field, or none at all — it now travels with the type on the
    // right instead of holding a column open on the left.
    const keyBadge = fieldData.primary
      ? "PK"
      : getFieldReference(fieldData)
        ? "FK"
        : fieldData.unique
          ? "UQ"
          : null;
    return (
      <div
        className="group w-full overflow-hidden"
        style={{
          borderBottom:
            settings.sketchMode || index === visibleFields.length - 1
              ? "none"
              : `1px solid ${tint(tableData.color, 0.25)}`,
        }}
        onPointerEnter={(e) => {
          if (!e.isPrimary) return;

          setHoveredField(index);
          setHoveredTable({
            tableId: tableData.id,
            fieldId: fieldData.id,
          });
        }}
        onPointerLeave={(e) => {
          if (!e.isPrimary) return;

          setHoveredField(null);
          setHoveredTable({
            tableId: null,
            fieldId: null,
          });
        }}
        onPointerDown={(e) => {
          // Required for onPointerLeave to trigger when a touch pointer leaves
          // https://stackoverflow.com/a/70976017/1137077
          e.target.releasePointerCapture(e.pointerId);
        }}
      >
        <div className="h-[40px] px-3 py-1 flex items-center gap-[6px]">
          <button
            className="shrink-0 w-[10px] h-[10px] bg-[#6965dbcc] rounded-full"
            onPointerDown={(e) => {
              if (!e.isPrimary) return;

              handleGripField();
              const fieldY =
                tableData.y +
                getFieldOffsetY(
                  visibleFields,
                  index,
                  cardWidth,
                  settings.showComments,
                ) +
                tableHeaderHeight +
                tableColorStripHeight +
                getCommentHeight(
                  tableData.comment,
                  cardWidth,
                  settings.showComments,
                ) +
                14;
              setLinkingLine((prev) => ({
                ...prev,
                startFieldId: fieldData.id,
                startTableId: tableData.id,
                startX: tableData.x + 15,
                startY: fieldY,
                endX: tableData.x + 15,
                endY: fieldY,
              }));
            }}
          />
          <span
            className="field-name cursor-text"
            title={fieldData.name}
            onClick={(e) => {
              if (layout.readOnly) return;
              e.stopPropagation();
              setEditingFieldId(fieldData.id);
            }}
          >
            {editingFieldId === fieldData.id ? (
              <input
                defaultValue={fieldData.name}
                className="w-full bg-transparent border border-blue-400 rounded px-1 outline-none"
                {...inlineInputProps(
                  (value) => commitFieldName(fieldData, value),
                  () => setEditingFieldId(null),
                )}
              />
            ) : (
              fieldData.name
            )}
          </span>
          {/* Badge + type ride together against the right edge:
              `id            PK  BIGINT`. Only the type half is clickable, so
              the badge stays a label rather than a hidden control. */}
          <div className="field-right flex items-center gap-[6px]">
            {keyBadge && (
              <span className={`key-badge ${keyBadge.toLowerCase()}`}>
                {keyBadge}
              </span>
            )}
            <div
              className="flex items-center gap-[6px] shrink-0"
              onClick={(e) => {
                // Click the type to change it; blank row space stays free for
                // selecting and dragging the card.
                if (layout.readOnly || editingTypeFieldId === fieldData.id) return;
                e.stopPropagation();
                setEditingTypeFieldId(fieldData.id);
              }}
            >
              {editingTypeFieldId === fieldData.id ? (
                <div
                  className="w-[130px]"
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Select
                    size="small"
                    className="w-full"
                    filter
                    autoFocus
                    defaultOpen
                    defaultValue={fieldData.type}
                    optionList={typeOptions.map((tp) => ({
                      label: tp,
                      value: tp,
                    }))}
                    onChange={(value) => commitFieldType(fieldData, value)}
                    onBlur={() => setEditingTypeFieldId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingTypeFieldId(null);
                    }}
                  />
                </div>
              ) : (
                <>
                  {settings.showDataTypes && (
                    <div className="flex gap-[6px] items-center">
                      {!fieldData.notNull && (
                        <span
                          className="text-[12px]"
                          style={{ color: "var(--canvas-ink3)" }}
                          title={t("nullable")}
                        >
                          ?
                        </span>
                      )}
                      {/* Plain mono text, not a chip: it already reads as
                          secondary next to the badge it sits beside. */}
                      <span className="field-type whitespace-nowrap">
                        {fieldData.type +
                          ((fieldResolved.isSized || fieldResolved.hasPrecision) &&
                          fieldData.size &&
                          fieldData.size !== ""
                            ? `(${fieldData.size})`
                            : "")}
                      </span>
                    </div>
                  )}
                  {hoveredField === index && !layout.readOnly && (
                    <Button
                      theme="borderless"
                      size="small"
                      type="danger"
                      title={t("delete")}
                      icon={<IconDeleteStroked />}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteField(fieldData, tableData.id);
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        {showFieldComment && (
          <div className="ms-3 px-3 pb-3">
            <div
              className={`text-xs line-clamp-2 ${settings.mode === "light" ? "text-zinc-600" : "text-zinc-200"}`}
            >
              {fieldData.comment}
            </div>
          </div>
        )}
      </div>
    );
  }
}
