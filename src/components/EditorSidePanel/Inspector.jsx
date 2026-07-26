import { useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Action, ObjectType, Cardinality, Constraint } from "../../data/constants";
import {
  useSelect,
  useDiagram,
  useAreas,
  useNotes,
  useUndoRedo,
  useTypes,
  useEnums,
  useLayout,
} from "../../hooks";
import { dbToTypes } from "../../data/datatypes";
import { getCustomTypesForDb } from "../../utils/customTypes";
import { fieldUpdatesForTypeChange } from "../../utils/fieldTypeChange";
import { appendField } from "../../utils/tableFields";
import AreaInfo from "./AreasTab/AreaDetails";
import NoteInfo from "./NotesTab/NoteInfo";
import RelationshipInfo from "./RelationshipsTab/RelationshipInfo";
import { LAYOUT, useLayoutRegime } from "../../layout/regime";

// Table colours offered in the inspector, from the approved design.
const SWATCHES = [
  "#3f5fc9",
  "#6259cf",
  "#1f7a5e",
  "#9a5a10",
  "#a53c72",
  "#4b4b5c",
];

const CARDINALITY_LABELS = {
  [Cardinality.ONE_TO_ONE]: "one_to_one",
  [Cardinality.ONE_TO_MANY]: "one_to_many",
  [Cardinality.MANY_TO_ONE]: "many_to_one",
};

/**
 * Publishes the bottom sheet's *measured* height as --sheet-h on <html>, and
 * returns the ref callback to hang on the sheet element.
 *
 * This is what keeps the zoom island tappable on a phone (bug A2): the island's
 * `bottom` is max(--m-bottom, --sheet-h + --isl-gap), so it rides above the
 * sheet instead of under it. The sheet keeps `max-height`, not `height`, so it
 * is content-sized with no dead air — which is precisely why a CSS-only
 * `calc(62vh + 12px)` could never work, and why this has to be a measurement.
 *
 * useLayoutEffect, not useEffect: the write has to land before the browser
 * paints the frame the sheet first appears in, or the island is buried for that
 * frame. The token's initial CSS value is --sheet-cap — the provable upper bound
 * — as a second line of defence.
 *
 * Element identity is held in state rather than a ref so the observer is rebuilt
 * when the panel swaps between its table and non-table markup, and torn down
 * when nothing is selected at all. Outside the sheet regime, and whenever no
 * sheet is mounted, the token is pinned to 0px: the rail and desktop layouts
 * park the zoom island at --m-bottom and are proven disjoint from the rail
 * without it.
 */
function useSheetHeightVar() {
  const regime = useLayoutRegime();
  const [el, setEl] = useState(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (regime !== LAYOUT.SHEET || !el) {
      root.style.setProperty("--sheet-h", "0px");
      return;
    }
    const write = () =>
      root.style.setProperty(
        "--sheet-h",
        `${el.getBoundingClientRect().height}px`,
      );
    write();
    // The sheet animates on `transform`, so its contentRect is final from frame
    // 0 and the island's 180ms `bottom` transition tracks it rather than lagging.
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty("--sheet-h", "0px");
    };
  }, [regime, el]);

  return setEl;
}

/** Properties of whatever is selected, as a panel on the right of the canvas. */
export default function Inspector() {
  const { t } = useTranslation();
  const { selectedElement, setSelectedElement } = useSelect();
  const {
    tables,
    relationships,
    database,
    updateTable,
    updateField,
    updateRelationship,
  } = useDiagram();
  const { areas } = useAreas();
  const { notes } = useNotes();
  const { types } = useTypes();
  const { enums } = useEnums();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { layout } = useLayout();
  const [openField, setOpenField] = useState(null);
  const sheetRef = useSheetHeightVar();

  const { element, id } = selectedElement;
  const table =
    element === ObjectType.TABLE ? tables.find((x) => x.id === id) : null;

  const typeOptions = useMemo(
    () => [
      ...Object.keys(dbToTypes[database] ?? {}),
      ...Object.keys(getCustomTypesForDb(database)),
      ...types.map((x) => x.name.toUpperCase()),
      ...enums.map((x) => x.name.toUpperCase()),
    ],
    [database, types, enums],
  );

  const close = () =>
    setSelectedElement((prev) => ({
      ...prev,
      element: ObjectType.NONE,
      id: -1,
      open: false,
    }));

  // Non-table selections keep their existing editors; only tables have a
  // designed layout so far.
  if (!table) {
    let body = null;
    let kind = null;
    let title = null;
    if (element === ObjectType.RELATIONSHIP) {
      const rel = relationships.find((x) => x.id === id);
      if (rel) {
        title = rel.name;
        kind = t("relationship");
        body = <RelationshipInfo data={rel} />;
      }
    } else if (element === ObjectType.AREA) {
      const i = areas.findIndex((x) => x.id === id);
      if (i !== -1) {
        title = areas[i].name;
        kind = t("subject_area");
        body = <AreaInfo data={areas[i]} i={i} />;
      }
    } else if (element === ObjectType.NOTE) {
      const i = notes.findIndex((x) => x.id === id);
      if (i !== -1) {
        title = notes[i].title;
        kind = t("note");
        body = <NoteInfo data={notes[i]} nid={i} />;
      }
    }
    if (!body) return null;
    return (
      <aside className="inspector" ref={sheetRef} aria-label={kind}>
        <div className="insp-scroll">
          <header className="ihead">
            <div className="ieyebrow">
              <span className="dot" style={{ background: "#6259cf" }} />
              {kind}
            </div>
            <h1 className="ititle">{title}</h1>
          </header>
          <section className="sec">{body}</section>
        </div>
      </aside>
    );
  }

  const readOnly = layout.readOnly;

  const pushEdit = (undo, redo, extra = {}) => {
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.TABLE,
        component: "self",
        tid: table.id,
        undo,
        redo,
        message: t("edit_table", { tableName: table.name, extra: "" }),
        ...extra,
      },
    ]);
    setRedoStack([]);
  };

  const editTable = (values, previous) => {
    if (readOnly) return;
    pushEdit(previous, values);
    updateTable(table.id, values);
  };

  const editField = (field, values) => {
    if (readOnly) return;
    const previous = Object.fromEntries(
      Object.keys(values).map((k) => [k, field[k]]),
    );
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.TABLE,
        component: "field",
        tid: table.id,
        fid: field.id,
        undo: previous,
        redo: values,
        message: t("edit_table", { tableName: table.name, extra: "[field]" }),
      },
    ]);
    setRedoStack([]);
    updateField(table.id, field.id, values);
  };

  // Free-text field editors. Typing updates the document so the canvas follows
  // along, but the *commit* happens on blur and pushes one undo entry for the
  // whole edit. Pushing that entry is not only about history: Workspace's
  // autosave marks the diagram dirty from the undo stack, so a field edited
  // without one is silently never saved.
  const textField = (field, key) => ({
    value: field[key] ?? "",
    readOnly,
    onChange: (e) => updateField(table.id, field.id, { [key]: e.target.value }),
    onFocus: (e) => {
      e.target.dataset.was = e.target.value;
    },
    onBlur: (e) => {
      const was = e.target.dataset.was;
      if (was === undefined || was === e.target.value) return;
      // Restore, then commit through editField so undo/redo and the dirty flag
      // both see a single before/after pair.
      updateField(table.id, field.id, { [key]: was });
      editField({ ...field, [key]: was }, { [key]: e.target.value });
    },
  });

  // The relationship, if any, in which this field is the referencing side.
  const foreignKeyOf = (field) =>
    relationships.find(
      (r) => r.startTableId === table.id && r.startFieldId === field.id,
    );

  const indexCount = table.indices?.length ?? 0;
  const relCount = relationships.filter(
    (r) => r.startTableId === table.id || r.endTableId === table.id,
  ).length;

  return (
    <aside className="inspector" ref={sheetRef} aria-label={t("table")}>
      <div className="insp-scroll">
        <header className="ihead">
          <div className="ihead-top">
            <div className="ieyebrow">
              <span className="dot" style={{ background: table.color }} />
              {t("table")}
              {t("table").toUpperCase() !== "TABLE" && " · TABLE"}
            </div>
            <button
              className="insp-close"
              onClick={close}
              aria-label={t("back_to_lists")}
            >
              ✕
            </button>
          </div>
          <h1 className="ititle">{table.name}</h1>
          <p className="isub">
            {t("inspector_summary", {
              fields: table.fields.length,
              indices: indexCount,
              relationships: relCount,
            })}
          </p>
        </header>

        <section className="sec">
          <h2 className="sech">{t("basic_info")}</h2>
          <div className="grid2">
            <div className="f">
              <label>{t("table_name")}</label>
              <input
                value={table.name}
                readOnly={readOnly}
                onChange={(e) => updateTable(table.id, { name: e.target.value })}
                onFocus={(e) => (e.target.dataset.was = e.target.value)}
                onBlur={(e) => {
                  const was = e.target.dataset.was;
                  if (was !== undefined && was !== e.target.value)
                    pushEdit({ name: was }, { name: e.target.value });
                }}
              />
            </div>
            <div className="f">
              <label>{t("table_alias")}</label>
              <input
                value={table.alias ?? ""}
                readOnly={readOnly}
                placeholder="—"
                onChange={(e) =>
                  updateTable(table.id, { alias: e.target.value })
                }
                onFocus={(e) => (e.target.dataset.was = e.target.value)}
                onBlur={(e) => {
                  const was = e.target.dataset.was;
                  if (was !== undefined && was !== e.target.value)
                    pushEdit({ alias: was }, { alias: e.target.value });
                }}
              />
            </div>
          </div>
          <div className="f">
            <label>{t("comment")}</label>
            <textarea
              rows="2"
              value={table.comment ?? ""}
              readOnly={readOnly}
              onChange={(e) =>
                updateTable(table.id, { comment: e.target.value })
              }
              onFocus={(e) => (e.target.dataset.was = e.target.value)}
              onBlur={(e) => {
                const was = e.target.dataset.was;
                if (was !== undefined && was !== e.target.value)
                  pushEdit({ comment: was }, { comment: e.target.value });
              }}
            />
          </div>
          <div className="f inline">
            <label>{t("color")}</label>
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  className={`sw${table.color?.toLowerCase() === c ? " on" : ""}`}
                  style={{ background: c }}
                  aria-label={c}
                  disabled={readOnly}
                  onClick={() => editTable({ color: c }, { color: table.color })}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="sec last">
          <div className="sechrow">
            <h2 className="sech">
              {t("fields")} <span className="count">{table.fields.length}</span>
            </h2>
            <button
              className="mini"
              disabled={readOnly}
              onClick={() => {
                const newId = appendField({
                  table,
                  updateTable,
                  setUndoStack,
                  setRedoStack,
                  t,
                });
                setOpenField(newId);
              }}
            >
              ＋ {t("add_field")}
            </button>
          </div>

          <div className="flist">
            {table.fields.map((field) => {
              const isOpen = openField === field.id;
              const fk = foreignKeyOf(field);
              const row = (
                <button
                  className={`frow${isOpen ? " on" : ""}`}
                  onClick={() => setOpenField(isOpen ? null : field.id)}
                >
                  <span className="fchev">{isOpen ? "▾" : "▸"}</span>
                  <span className="fn">{field.name || "—"}</span>
                  <span className="fr">
                    {field.primary && <span className="tag pk">PK</span>}
                    {!field.primary && fk && <span className="tag fk">FK</span>}
                    {!field.primary && !fk && field.unique && (
                      <span className="tag uq">UQ</span>
                    )}
                    <span className="ft">{field.type}</span>
                  </span>
                </button>
              );

              if (!isOpen) return <div key={field.id}>{row}</div>;

              return (
                <div className="fcard" key={field.id}>
                  {row}
                  <div className="fbody">
                    <div className="f">
                      <label>{t("field_name")}</label>
                      <input
                        value={field.name}
                        readOnly={readOnly}
                        onChange={(e) =>
                          updateField(table.id, field.id, {
                            name: e.target.value,
                          })
                        }
                        onFocus={(e) => (e.target.dataset.was = e.target.value)}
                        onBlur={(e) => {
                          const was = e.target.dataset.was;
                          if (was !== undefined && was !== e.target.value)
                            editField(field, { name: e.target.value });
                        }}
                      />
                    </div>
                    <div className="grid2">
                      <div className="f">
                        <label>{t("type")}</label>
                        <select
                          className="sel"
                          value={field.type}
                          disabled={readOnly}
                          onChange={(e) =>
                            editField(
                              field,
                              fieldUpdatesForTypeChange(
                                database,
                                field,
                                e.target.value,
                              ),
                            )
                          }
                        >
                          {typeOptions.map((x) => (
                            <option key={x} value={x}>
                              {x}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="f">
                        <label>{t("size")}</label>
                        <input placeholder="—" {...textField(field, "size")} />
                      </div>
                    </div>
                    <div className="f">
                      <label>{t("default_value")}</label>
                      <input
                        placeholder={t("not_set")}
                        {...textField(field, "default")}
                      />
                    </div>
                    <div className="f">
                      <label>{t("constraints")}</label>
                      <div className="flags">
                        {[
                          ["primary", t("primary")],
                          ["notNull", t("not_null")],
                          ["unique", t("unique")],
                          ["increment", t("autoincrement")],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            className={`flag${field[key] ? " on" : ""}`}
                            disabled={readOnly}
                            onClick={() =>
                              editField(field, { [key]: !field[key] })
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="f">
                      <label>{t("comment")}</label>
                      <input {...textField(field, "comment")} />
                    </div>

                    {fk && (
                      <div className="fk-block">
                        <div className="fk-head">
                          {t("foreign")} · FOREIGN KEY
                        </div>
                        <div className="grid2">
                          <div className="f">
                            <label>{t("referenced_table")}</label>
                            <div className="sel sel-static">
                              {tables.find((x) => x.id === fk.endTableId)
                                ?.name ?? "—"}
                            </div>
                          </div>
                          <div className="f">
                            <label>{t("referenced_field")}</label>
                            <div className="sel sel-static">
                              {tables
                                .find((x) => x.id === fk.endTableId)
                                ?.fields.find((f) => f.id === fk.endFieldId)
                                ?.name ?? "—"}
                            </div>
                          </div>
                        </div>
                        <div className="f">
                          <label>{t("cardinality")}</label>
                          <select
                            className="sel"
                            value={fk.cardinality}
                            disabled={readOnly}
                            onChange={(e) =>
                              updateRelationship(fk.id, {
                                cardinality: e.target.value,
                              })
                            }
                          >
                            {Object.entries(CARDINALITY_LABELS).map(
                              ([value, key]) => (
                                <option key={value} value={value}>
                                  {t(key)}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                        <div className="grid2">
                          <div className="f">
                            <label>ON DELETE</label>
                            <select
                              className="sel"
                              value={fk.deleteConstraint}
                              disabled={readOnly}
                              onChange={(e) =>
                                updateRelationship(fk.id, {
                                  deleteConstraint: e.target.value,
                                })
                              }
                            >
                              {Object.values(Constraint).map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="f">
                            <label>ON UPDATE</label>
                            <select
                              className="sel"
                              value={fk.updateConstraint}
                              disabled={readOnly}
                              onChange={(e) =>
                                updateRelationship(fk.id, {
                                  updateConstraint: e.target.value,
                                })
                              }
                            >
                              {Object.values(Constraint).map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
}
