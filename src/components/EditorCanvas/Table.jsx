import { useMemo, useState } from "react";
import {
  Action,
  Tab,
  ObjectType,
  tableHeaderHeight,
  tableColorStripHeight,
} from "../../data/constants";
import {
  IconChevronDown,
  IconChevronUp,
  IconMore,
  IconDeleteStroked,
  IconEditStroked,
  IconCopyStroked,
  IconKeyStroked,
  IconLock,
  IconUnlock,
} from "@douyinfe/semi-icons";
import { nanoid } from "nanoid";
import {
  Popover,
  Tag,
  Button,
  ButtonGroup,
  SideSheet,
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
} from "../../hooks";
import TableInfo from "../EditorSidePanel/TablesTab/TableInfo";
import { useTranslation } from "react-i18next";
import { getCustomTypesForDb, resolveType } from "../../utils/customTypes";
import { fieldUpdatesForTypeChange } from "../../utils/fieldTypeChange";
import { dbToTypes } from "../../data/datatypes";
import { isRtl } from "../../i18n/utils/rtl";
import i18n from "../../i18n/i18n";
import {
  getCommentHeight,
  getFieldOffsetY,
  getTableHeight,
  getVisibleFieldEntries,
  getVisibleFields,
  getRelationshipFields,
} from "../../utils/utils";

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
  const { layout } = useLayout();
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

  const borderColor = useMemo(
    () => (settings.mode === "light" ? "border-zinc-300" : "border-zinc-600"),
    [settings.mode],
  );

  const height = getTableHeight(
    tableData,
    settings.tableWidth,
    settings.showComments,
    relationships,
  );

  const visibleFieldEntries = useMemo(
    () => getVisibleFieldEntries(tableData, relationships),
    [tableData, relationships],
  );

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
      x: tableData.x + 24,
      y: tableData.y + 24,
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

  // Always open the edit side sheet, sidebar visible or not — double-clicking
  // a table should edit it in place, not just scroll the side panel.
  // editFromCanvas distinguishes this from the panel's accordion, which sets
  // the same open/element/id state but must not pop the sheet.
  const openEditor = () => {
    setSelectedElement((prev) => ({
      ...prev,
      currentTab: Tab.TABLES,
      element: ObjectType.TABLE,
      id: tableData.id,
      open: true,
      editFromCanvas: true,
    }));
    if (layout.sidebar && selectedElement.currentTab === Tab.TABLES) {
      document
        .getElementById(`scroll_table_${tableData.id}`)
        ?.scrollIntoView({ behavior: "smooth" });
    }
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
      <foreignObject
        key={tableData.id}
        x={tableData.x}
        y={tableData.y}
        width={settings.tableWidth}
        height={height}
        className="group drop-shadow-lg rounded-md cursor-move"
        onPointerDown={onPointerDown}
      >
        <div
          onDoubleClick={openEditor}
          className={`relative border-2 hover:border-dashed hover:border-[#6965db]
               select-none rounded-lg w-full ${
                 settings.mode === "light"
                   ? "bg-zinc-100 text-zinc-800"
                   : "bg-zinc-800 text-zinc-200"
               } ${isSelected ? "border-solid border-[#6965db]" : borderColor}`}
          style={{ direction: "ltr" }}
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
          <div
            className="h-[10px] w-full rounded-t-md"
            style={{ backgroundColor: tableData.color }}
          />
          <div
            className={`${
              visibleFieldEntries.length === 0
                ? "rounded-b-md"
                : "border-b border-gray-400"
            } ${
              settings.mode === "light" ? "bg-zinc-100" : "bg-zinc-900"
            } ${tableData.comment && settings.showComments ? "pb-3" : ""}`}
          >
            <div
              className={`overflow-hidden font-bold h-[40px] flex justify-between items-center gap-2`}
            >
              <div
                className="px-3 overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1"
                onDoubleClick={(e) => {
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
                  tableData.name
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
                        className={
                          "ms-4 font-mono " +
                          (resolved.isCustom ? "" : resolved.color)
                        }
                        style={
                          resolved.isCustom ? { color: resolved.color } : {}
                        }
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
      <SideSheet
        title={t("edit")}
        size="small"
        visible={
          selectedElement.element === ObjectType.TABLE &&
          selectedElement.id === tableData.id &&
          selectedElement.open &&
          (selectedElement.editFromCanvas || !layout.sidebar)
        }
        onCancel={() =>
          setSelectedElement((prev) => ({
            ...prev,
            open: !prev.open,
            editFromCanvas: false,
          }))
        }
        style={{ paddingBottom: "16px" }}
      >
        <div className="sidesheet-theme">
          <TableInfo data={tableData} />
        </div>
      </SideSheet>
    </>
  );

  function field(fieldData, index) {
    const fieldResolved = resolveType(database, fieldData.type);
    const showFieldComment = fieldData.comment && settings.showComments;
    return (
      <div
        className={`${
          index === visibleFields.length - 1 ? "" : "border-b border-gray-400"
        } group w-full overflow-hidden`}
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
        onDoubleClick={(e) => {
          // Anywhere on the row except the name span (which edits the name
          // and stops propagation): edit the field's type in place.
          if (layout.readOnly) return;
          e.stopPropagation();
          setEditingTypeFieldId(fieldData.id);
        }}
      >
        <div className="h-[36px] px-2 py-1 flex justify-between items-center gap-1">
          <div
            className={`${
              hoveredField === index ? "text-zinc-400" : ""
            } flex items-center gap-2 overflow-hidden`}
          >
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
                    settings.tableWidth,
                    settings.showComments,
                  ) +
                  tableHeaderHeight +
                  tableColorStripHeight +
                  getCommentHeight(
                    tableData.comment,
                    settings.tableWidth,
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
              className="overflow-hidden text-ellipsis whitespace-nowrap"
              title={fieldData.name}
              onDoubleClick={(e) => {
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
          </div>
          <div className="text-zinc-400 flex items-center gap-1 shrink-0">
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
                  <div className="flex gap-1 items-center">
                    {fieldData.primary && <IconKeyStroked />}
                    {!fieldData.notNull && <span className="font-mono">?</span>}
                    <span
                      className={
                        "font-mono " +
                        (fieldResolved.isCustom ? "" : fieldResolved.color)
                      }
                      style={
                        fieldResolved.isCustom
                          ? { color: fieldResolved.color }
                          : {}
                      }
                    >
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
