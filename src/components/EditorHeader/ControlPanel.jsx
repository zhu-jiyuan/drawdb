import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { layoutTables } from "../../../shared/tableLayout";
import {
  buildTableWidths,
  getRequiredTableWidth,
} from "../../utils/tableWidth";
import { useExtensions } from "../../context/ExtensionsContext";
import { useMatch, useParams } from "react-router-dom";
import { Toast, Typography } from "@douyinfe/semi-ui";
import { toPng, toJpeg, toSvg } from "html-to-image";
import { Action, ObjectType, Tab, State, MODAL, SIDESHEET, DB, IMPORT_FROM, noteWidth, pngExportPixelRatio } from "../../data/constants";
import jsPDF from "jspdf";
import { useHotkeys } from "react-hotkeys-hook";
import { Validator } from "jsonschema";
import { areaSchema, noteSchema, tableSchema } from "../../data/schemas";
import { db } from "../../data/db";
import { useLayout, useSettings, useTransform, useDiagram, useUndoRedo, useSelect, useSaveState, useTypes, useNotes, useAreas, useEnums, useFullscreen, useNavigateWithParams } from "../../hooks";
import { enterFullscreen, exitFullscreen } from "../../utils/fullscreen";
import { applyHistoryEntry } from "../../utils/history";
import { dataURItoBlob } from "../../utils/utils";
import DocIsland from "../islands/DocIsland";
import ZoomIsland from "../islands/ZoomIsland";
import CommandPalette from "../CommandPalette";
import { flattenMenu } from "../../utils/commandRegistry";
import Sidesheet from "./SideSheet/Sidesheet";
import Modal from "./Modal/Modal";
import { useTranslation } from "react-i18next";
import { exportSQL } from "../../utils/exportSQL";
import { databases } from "../../data/databases";
import { jsonToMermaid } from "../../utils/exportAs/mermaid";
import { jsonToDocumentation } from "../../utils/exportAs/documentation";
import { IdContext } from "../Workspace";
import { socials } from "../../data/socials";
import { toDBML } from "../../utils/exportAs/dbml";
import { exportSavedData } from "../../utils/exportSavedData";
import { nanoid } from "nanoid";
import { getTableHeight } from "../../utils/utils";
import { deleteFromCache, STORAGE_KEY } from "../../utils/cache";
import { DateTime } from "luxon";
import ConfigureCustomTypes from "./ConfigureCustomTypes";
import { useDiagramList } from "./Modal/Open/hooks/useDiagramList";
import { mergeDiagrams, sortDiagrams } from "./Modal/Open/diagram";

import {
  jsonToMySQL,
  jsonToPostgreSQL,
  jsonToSQLite,
  jsonToMariaDB,
  jsonToSQLServer,
  jsonToOracleSQL,
} from "../../utils/exportSQL/generic";

// Dialects offered when the diagram is database-agnostic. Import and export each
// spelled all six out in full, so adding one meant two edits across ~190 lines
// that differed only in these three columns.
const GENERIC_DIALECTS = [
  { db: DB.MYSQL, name: "MySQL", to: jsonToMySQL },
  { db: DB.POSTGRES, name: "PostgreSQL", to: jsonToPostgreSQL },
  { db: DB.SQLITE, name: "SQLite", to: jsonToSQLite },
  { db: DB.MARIADB, name: "MariaDB", to: jsonToMariaDB },
  { db: DB.MSSQL, name: "MSSQL", to: jsonToSQLServer },
  { db: DB.ORACLESQL, name: "Oracle", label: "Beta", to: jsonToOracleSQL },
];

export default function ControlPanel({
  title,
  setTitle,
  lastSaved,
}) {
  const { id: diagramId } = useParams();

  const [modal, setModal] = useState(MODAL.NONE);
  const [sidesheet, setSidesheet] = useState(SIDESHEET.NONE);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Re-render so "Saved 2 minutes ago" keeps up with the clock. Only the setter
  // is used: the value is a bare re-render trigger, and getState() recomputes
  // the label from `lastSaved` on every render anyway.
  const [, tickRelativeTime] = useState(0);
  const [importDb, setImportDb] = useState("");
  const [exportData, setExportData] = useState({
    data: "",
    filename: `${title}_${new Date().toISOString()}`,
    extension: "",
  });

  const openExportModal = (modalType) => {
    setExportData((prev) => ({
      ...prev,
      filename: `${title}_${new Date().toISOString()}`,
    }));
    setModal(modalType);
  };

  // Every code export opens the modal first, then fills it in — keep that order,
  // the modal shows a spinner until data lands.
  const exportCode = (build, extension = "sql") => {
    openExportModal(MODAL.CODE);
    setExportData((prev) => ({ ...prev, data: build(), extension }));
  };

  const sqlPayload = () => ({
    tables,
    references: relationships,
    types,
    database,
  });
  const [importFrom, setImportFrom] = useState(IMPORT_FROM.JSON);
  const { saveState, setSaveState } = useSaveState();
  const { layout, setLayout } = useLayout();
  const { settings, setSettings } = useSettings();
  const {
    relationships,
    tables,
    setTables,
    addTable,
    updateTable,
    deleteField,
    deleteTable,
    updateField,
    setRelationships,
    addRelationship,
    deleteRelationship,
    updateRelationship,
    database,
  } = useDiagram();
  const { enums, setEnums, deleteEnum, addEnum, updateEnum } = useEnums();
  const { types, addType, deleteType, updateType, setTypes } = useTypes();
  const { notes, setNotes, updateNote, addNote, deleteNote } = useNotes();
  const { areas, setAreas, updateArea, addArea, deleteArea } = useAreas();
  const { undoStack, redoStack, setUndoStack, setRedoStack } = useUndoRedo();
  const { selectedElement, setSelectedElement } = useSelect();
  const { transform, setTransform } = useTransform();
  const { t, i18n } = useTranslation();
  const { gistId, setGistId } = useContext(IdContext);
  const isTemplate = useMatch("/editor/templates/:id");
  const navigate = useNavigateWithParams();
  const extensions = useExtensions();

  // The context surface undo/redo operate on. `tables`/`areas`/`notes`/`types`
  // are render-time snapshots, which is what the history reducers expect: a write
  // made while applying an entry is not visible to a later read in the same pass.
  const historyApi = () => ({
    tables,
    areas,
    notes,
    types,
    addTable,
    updateTable,
    deleteTable,
    updateField,
    deleteField,
    setRelationships,
    addRelationship,
    deleteRelationship,
    updateRelationship,
    addArea,
    updateArea,
    deleteArea,
    addNote,
    updateNote,
    deleteNote,
    addType,
    updateType,
    deleteType,
    setTypes,
    addEnum,
    updateEnum,
    deleteEnum,
    setUndoStack,
    setRedoStack,
  });

  // Both directions are the same walk over the entry; see utils/history.js.
  // The readOnly guard lives here rather than only on the menu entry: the menu
  // item and the toolbar button are disabled when readOnly, but `useHotkeys`
  // calls straight through, so Ctrl+Z used to mutate a document the editor was
  // only displaying (a version preview sets layout.readOnly — Versions.jsx).
  // Workspace's save effect is readOnly-gated, so that mutation was never
  // persisted: the on-screen diagram silently stopped matching the server.
  // Every other mutating handler here (del, duplicate, paste, cut, autoArrange)
  // already guards the same way.
  const undo = () => {
    if (layout.readOnly) return;
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.filter((_, i) => i !== prev.length - 1));
    applyHistoryEntry(entry, "undo", historyApi());
  };

  const redo = () => {
    if (layout.readOnly) return;
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.filter((_, i) => i !== prev.length - 1));
    applyHistoryEntry(entry, "redo", historyApi());
  };

  const fileImport = () => setModal(MODAL.IMPORT);
  const viewGrid = () =>
    setSettings((prev) => ({ ...prev, showGrid: !prev.showGrid }));
  const snapToGrid = () =>
    setSettings((prev) => ({ ...prev, snapToGrid: !prev.snapToGrid }));
  const zoomIn = () =>
    setTransform((prev) => ({ ...prev, zoom: prev.zoom * 1.2 }));
  const zoomOut = () =>
    setTransform((prev) => ({ ...prev, zoom: prev.zoom / 1.2 }));
  const viewStrictMode = () => {
    setSettings((prev) => ({ ...prev, hideIssues: !prev.hideIssues }));
  };
  const viewFieldSummary = () => {
    setSettings((prev) => ({
      ...prev,
      showFieldSummary: !prev.showFieldSummary,
    }));
  };
  const copyAsImage = () => {
    toPng(document.getElementById("canvas"), {
      pixelRatio: pngExportPixelRatio,
    }).then(function (dataUrl) {
      const blob = dataURItoBlob(dataUrl);
      navigator.clipboard
        .write([new ClipboardItem({ "image/png": blob })])
        .then(() => {
          Toast.success(t("copied_to_clipboard"));
        })
        .catch(() => {
          Toast.error(t("oops_smth_went_wrong"));
        });
    });
  };
  const resetView = () =>
    setTransform((prev) => ({ ...prev, zoom: 1, pan: { x: 0, y: 0 } }));
  const fitWindow = () => {
    const canvas = document.getElementById("canvas").getBoundingClientRect();

    const minMaxXY = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    };

    // settings.tableWidth is the floor a card may not go below, not its width —
    // cards grow to fit their own content. Measuring the bounding box against
    // the floor makes the diagram look narrower than it is, so "fit window"
    // fits the wrong box: a 446px-wide `orders` card was measured at 240 and
    // ended up 78px off the right edge of a 390px screen after fitting.
    const widths = buildTableWidths(tables, database, settings);
    tables.forEach((table) => {
      const width = widths.get(table.id) ?? settings.tableWidth;
      minMaxXY.minX = Math.min(minMaxXY.minX, table.x);
      minMaxXY.minY = Math.min(minMaxXY.minY, table.y);
      minMaxXY.maxX = Math.max(minMaxXY.maxX, table.x + width);
      minMaxXY.maxY = Math.max(
        minMaxXY.maxY,
        table.y +
          getTableHeight(table, width, settings.showComments, relationships),
      );
    });

    areas.forEach((area) => {
      minMaxXY.minX = Math.min(minMaxXY.minX, area.x);
      minMaxXY.minY = Math.min(minMaxXY.minY, area.y);
      minMaxXY.maxX = Math.max(minMaxXY.maxX, area.x + area.width);
      minMaxXY.maxY = Math.max(minMaxXY.maxY, area.y + area.height);
    });

    notes.forEach((note) => {
      minMaxXY.minX = Math.min(minMaxXY.minX, note.x);
      minMaxXY.minY = Math.min(minMaxXY.minY, note.y);
      minMaxXY.maxX = Math.max(
        minMaxXY.maxX,
        note.x + (note.width ?? noteWidth),
      );
      minMaxXY.maxY = Math.max(minMaxXY.maxY, note.y + note.height);
    });

    // Nothing on the canvas leaves the bounding box at its ±Infinity seed, and
    // the arithmetic below then yields width/height = -Infinity, scale = -0 and
    // centre = NaN. TransformContext defends against the NaN (pan falls back to
    // the previous value) and clamps the zoom, so this never crashed — it just
    // silently slammed an empty diagram from 100% to the 0.02 floor, measured
    // in both engines. That is the state a brand-new diagram is in, and the
    // control is the zoom readout itself, so the first thing a new user taps
    // strands them at 2% needing ~21 zoom-in taps to get back.
    // "Fit the content" has no meaning with no content: reset to the default
    // view instead, which is where an empty canvas already sits.
    if (!Number.isFinite(minMaxXY.minX) || !Number.isFinite(minMaxXY.minY)) {
      setTransform((prev) => ({ ...prev, zoom: 1, pan: { x: 0, y: 0 } }));
      return;
    }

    const padding = 10;
    const width = minMaxXY.maxX - minMaxXY.minX + padding;
    const height = minMaxXY.maxY - minMaxXY.minY + padding;

    const scaleX = canvas.width / width;
    const scaleY = canvas.height / height;
    // Making sure the scale is a multiple of 0.05
    const scale = Math.floor(Math.min(scaleX, scaleY) * 20) / 20;

    const centerX = (minMaxXY.minX + minMaxXY.maxX) / 2;
    const centerY = (minMaxXY.minY + minMaxXY.maxY) / 2;

    setTransform((prev) => ({
      ...prev,
      zoom: scale,
      pan: { x: centerX, y: centerY },
    }));
  };
  const edit = () => {
    if (selectedElement.element === ObjectType.TABLE) {
      if (!layout.sidebar) {
        setSelectedElement((prev) => ({
          ...prev,
          open: true,
        }));
      } else {
        setSelectedElement((prev) => ({
          ...prev,
          open: true,
          currentTab: Tab.TABLES,
        }));
        if (selectedElement.currentTab !== Tab.TABLES) return;
        document
          .getElementById(`scroll_table_${selectedElement.id}`)
          .scrollIntoView({ behavior: "smooth" });
      }
    } else if (selectedElement.element === ObjectType.AREA) {
      if (layout.sidebar) {
        setSelectedElement((prev) => ({
          ...prev,
          currentTab: Tab.AREAS,
        }));
        if (selectedElement.currentTab !== Tab.AREAS) return;
        document
          .getElementById(`scroll_area_${selectedElement.id}`)
          .scrollIntoView({ behavior: "smooth" });
      } else {
        setSelectedElement((prev) => ({
          ...prev,
          open: true,
          editFromToolbar: true,
        }));
      }
    } else if (selectedElement.element === ObjectType.NOTE) {
      if (layout.sidebar) {
        setSelectedElement((prev) => ({
          ...prev,
          currentTab: Tab.NOTES,
          open: false,
        }));
        if (selectedElement.currentTab !== Tab.NOTES) return;
        document
          .getElementById(`scroll_note_${selectedElement.id}`)
          .scrollIntoView({ behavior: "smooth" });
      } else {
        setSelectedElement((prev) => ({
          ...prev,
          open: true,
          editFromToolbar: true,
        }));
      }
    }
  };
  const del = () => {
    if (layout.readOnly) {
      return;
    }
    switch (selectedElement.element) {
      case ObjectType.TABLE:
        deleteTable(selectedElement.id);
        break;
      case ObjectType.NOTE:
        deleteNote(selectedElement.id);
        break;
      case ObjectType.AREA:
        deleteArea(selectedElement.id);
        break;
      default:
        break;
    }
  };
  const duplicate = () => {
    if (layout.readOnly) {
      return;
    }
    switch (selectedElement.element) {
      case ObjectType.TABLE: {
        const copiedTable = tables.find((t) => t.id === selectedElement.id);
        addTable({
          table: {
            ...copiedTable,
            x: copiedTable.x + 20,
            y: copiedTable.y + 20,
            id: nanoid(),
          },
        });
        break;
      }
      case ObjectType.NOTE:
        addNote({
          ...notes[selectedElement.id],
          x: notes[selectedElement.id].x + 20,
          y: notes[selectedElement.id].y + 20,
          id: notes.length,
        });
        break;
      case ObjectType.AREA:
        addArea({
          ...areas[selectedElement.id],
          x: areas[selectedElement.id].x + 20,
          y: areas[selectedElement.id].y + 20,
          id: areas.length,
        });
        break;
      default:
        break;
    }
  };
  const copy = () => {
    switch (selectedElement.element) {
      case ObjectType.TABLE:
        navigator.clipboard
          .writeText(
            JSON.stringify(tables.find((t) => t.id === selectedElement.id)),
          )
          .catch(() => Toast.error(t("oops_smth_went_wrong")));
        break;
      case ObjectType.NOTE:
        navigator.clipboard
          .writeText(JSON.stringify({ ...notes[selectedElement.id] }))
          .catch(() => Toast.error(t("oops_smth_went_wrong")));
        break;
      case ObjectType.AREA:
        navigator.clipboard
          .writeText(JSON.stringify({ ...areas[selectedElement.id] }))
          .catch(() => Toast.error(t("oops_smth_went_wrong")));
        break;
      default:
        break;
    }
  };
  const paste = () => {
    if (layout.readOnly) {
      return;
    }
    navigator.clipboard.readText().then((text) => {
      let obj = null;
      try {
        obj = JSON.parse(text);
      } catch (error) {
        return;
      }
      const v = new Validator();
      if (v.validate(obj, tableSchema).valid) {
        addTable({
          table: {
            ...obj,
            x: obj.x + 20,
            y: obj.y + 20,
            id: nanoid(),
          },
        });
      } else if (v.validate(obj, areaSchema).valid) {
        addArea({
          ...obj,
          x: obj.x + 20,
          y: obj.y + 20,
          id: areas.length,
        });
      } else if (v.validate(obj, noteSchema).valid) {
        addNote({
          ...obj,
          x: obj.x + 20,
          y: obj.y + 20,
          id: notes.length,
        });
      }
    });
  };
  const cut = () => {
    if (layout.readOnly) {
      return;
    }
    copy();
    del();
  };
  const toggleDBMLEditor = () => {
    setLayout((prev) => ({ ...prev, dbmlEditor: !prev.dbmlEditor }));
  };
  // Same layered layout the MCP server uses (FK hierarchy, height-aware).
  //
  // This moves every table at once and the result is saved immediately, so it
  // has to be undoable: without an entry the previous layout is gone for good,
  // and Ctrl+Z instead replays whatever entry was underneath — against
  // coordinates that no longer describe the diagram. Recorded as the same bulk
  // MOVE entry a marquee drag produces, so it goes through the reducer path
  // that already exists rather than a special case.
  const autoArrange = () => {
    if (layout.readOnly) return;
    const arranged = layoutTables(
      structuredClone(tables),
      relationships,
      settings.tableWidth,
      (t) => getRequiredTableWidth(t, database, settings),
    );
    const moved = arranged.reduce((acc, next) => {
      const before = tables.find((t) => t.id === next.id);
      if (before && (before.x !== next.x || before.y !== next.y)) {
        acc.push({
          id: next.id,
          type: ObjectType.TABLE,
          undo: { x: before.x, y: before.y },
          redo: { x: next.x, y: next.y },
        });
      }
      return acc;
    }, []);
    if (moved.length) {
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.MOVE,
          bulk: true,
          message: t("auto_arrange"),
          elements: moved,
        },
      ]);
      setRedoStack([]);
    }
    setTables(arranged);
    setSaveState(State.SAVING);
  };
  const save = async () => {
    // Setting SAVING hands off to Workspace's save(): it knows diagramSource
    // and handles cloud vs local, new ids, and template routes correctly —
    // duplicating the cloud call here breaks /editor (no :id param) and
    // /editor/templates/:id, and bypasses the local-diagram guard.
    setSaveState(State.SAVING);
  };
  const { cloud, local } = useDiagramList();
  const recentlyOpenedDiagrams = useMemo(() => {
    const sorted = sortDiagrams(mergeDiagrams(cloud, local), {
      key: "lastModified",
      dir: "desc",
    });
    const seen = new Set();
    const recent = [];
    for (const entry of sorted) {
      if (entry.diagramId == null || seen.has(entry.diagramId)) continue;
      seen.add(entry.diagramId);
      recent.push(entry);
      if (recent.length === 10) break;
    }
    return recent;
  }, [cloud, local]);

  const open = () => setModal(MODAL.OPEN);
  const saveDiagramAs = () => setModal(MODAL.SAVEAS);

  const saveAsCopy = async (newTitle) => {
    const newId = uuidv4();
    const diagramData = {
      diagramId: newId,
      database,
      name: newTitle,
      gistId: "",
      loadedFromGistId: "",
      lastModified: new Date(),
      tables,
      references: relationships,
      notes,
      areas,
      pan: transform.pan,
      zoom: transform.zoom,
      ...(databases[database].hasEnums && { enums }),
      ...(databases[database].hasTypes && { types }),
    };

    if (typeof extensions.cloudSave === "function") {
      try {
        await extensions.cloudSave(diagramData, { isNew: true });
      } catch (err) {
        setSaveState(State.ERROR);
        Toast.error(t("oops_smth_went_wrong"));
        return;
      }
    } else {
      try {
        await db.diagrams.add(diagramData);
      } catch (err) {
        console.error(err);
        setSaveState(State.ERROR);
        Toast.error(t("oops_smth_went_wrong"));
        return;
      }
    }

    let toastId;
    toastId = Toast.success({
      duration: 8,
      content: (
        <span>
          {t("saved_as_copy")}{" "}
          <Typography.Text
            link={{
              href: `/editor/diagrams/${newId}${window.location.search}`,
              target: "_blank",
              rel: "noopener noreferrer",
            }}
            underline
            onClick={() => Toast.close(toastId)}
          >
            {newTitle}
          </Typography.Text>
        </span>
      ),
    });
  };

  const fullscreen = useFullscreen();
  const wasFullscreen = useRef(false);

  // Restore the chrome when EXITING fullscreen only. Running on mount too
  // would clobber the initial layout (e.g. the collapsed sidebar on phones).
  useEffect(() => {
    if (wasFullscreen.current && !fullscreen) {
      setLayout((p) => ({ ...p, header: true, sidebar: true, toolbar: true }));
    }
    wasFullscreen.current = fullscreen;
  }, [fullscreen, setLayout]);

  // "Saved just now" has to become "Saved 2 minutes ago" without a save to
  // trigger the re-render. 30s is well under the coarsest thing the label can
  // say (luxon rounds to whole minutes), and the timer only runs while a saved
  // timestamp is actually on screen.
  useEffect(() => {
    if (saveState !== State.SAVED || !lastSaved) return;
    const id = setInterval(() => tickRelativeTime((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [saveState, lastSaved]);

  const menu = {
    file: {
      new: {
        function: () => setModal(MODAL.NEW),
      },
      new_window: {
        function: () => window.open("/editor", "_blank"),
      },
      open: {
        function: open,
        shortcut: "Ctrl+O",
      },
      open_recent: {
        children: [
          ...(recentlyOpenedDiagrams && recentlyOpenedDiagrams.length > 0
            ? [
                ...recentlyOpenedDiagrams.map((diagram) => ({
                  id: diagram.diagramId,
                  name: diagram.name,
                  label: DateTime.fromJSDate(new Date(diagram.lastModified))
                    .setLocale(i18n.language)
                    .toRelative(),
                  function: () => {
                    navigate(`/editor/diagrams/${diagram.diagramId}`);
                  },
                })),
                { divider: true },
                {
                  name: t("see_all"),
                  function: () => open(),
                },
              ]
            : [
                {
                  name: t("no_saved_diagrams"),
                  disabled: true,
                },
              ]),
        ],

        function: () => {},
      },
      save: {
        function: save,
        shortcut: "Ctrl+S",
        disabled: layout.readOnly,
      },
      save_as: {
        function: saveDiagramAs,
        shortcut: "Ctrl+Shift+S",
        disabled: layout.readOnly,
      },
      save_as_template: {
        function: async () => {
          await db.templates
            .add({
              title: title,
              tables: tables,
              database: database,
              relationships: relationships,
              notes: notes,
              subjectAreas: areas,
              custom: 1,
              templateId: uuidv4(),
              ...(databases[database].hasEnums && { enums: enums }),
              ...(databases[database].hasTypes && { types: types }),
            })
            .then(() => {
              Toast.success(t("template_saved"));
            });
        },
      },
      rename: {
        function: () => {
          setModal(MODAL.RENAME);
        },
        disabled: layout.readOnly,
      },
      delete_diagram: {
        warning: {
          title: t("delete_diagram"),
          message: t("are_you_sure_delete_diagram"),
        },
        function: async () => {
          try {
            if (typeof extensions.cloudDelete === "function") {
              await extensions.cloudDelete(diagramId);
            } else {
              await db.diagrams
                .where("diagramId")
                .equals(diagramId)
                .delete();
            }
            setTitle("Untitled diagram");
            setTables([]);
            setRelationships([]);
            setAreas([]);
            setNotes([]);
            setTypes([]);
            setEnums([]);
            setUndoStack([]);
            setRedoStack([]);
            setGistId("");
            navigate("/editor/templates/blank", { replace: true });
          } catch {
            Toast.error(t("oops_smth_went_wrong"));
          }
        },
      },
      import_from: {
        children: [
          {
            function: () => {
              setModal(MODAL.IMPORT);
              setImportFrom(IMPORT_FROM.JSON);
            },
            name: "JSON",
            disabled: layout.readOnly,
          },
          {
            function: () => {
              setModal(MODAL.IMPORT);
              setImportFrom(IMPORT_FROM.DBML);
            },
            name: "DBML",
            disabled: layout.readOnly,
          },
        ],
      },
      import_from_source: {
        // Only a database-agnostic diagram offers a choice of dialect; once the
        // diagram has a database, the entry acts directly (see `function`).
        ...(database === DB.GENERIC && {
          children: GENERIC_DIALECTS.map(({ db, name, label }) => ({
            name,
            label,
            disabled: layout.readOnly,
            function: () => {
              setModal(MODAL.IMPORT_SRC);
              setImportDb(db);
            },
          })),
        }),
        function: () => {
          if (database === DB.GENERIC) return;

          setModal(MODAL.IMPORT_SRC);
        },
        disabled: layout.readOnly,
      },
      export_source: {
        ...(database === DB.GENERIC && {
          children: GENERIC_DIALECTS.map(({ name, label, to }) => ({
            name,
            label,
            function: () => exportCode(() => to(sqlPayload())),
          })),
        }),
        function: () => {
          if (database === DB.GENERIC) return;
          exportCode(() => exportSQL({ ...sqlPayload(), enums }));
        },
      },
      export_as: {
        children: [
          {
            name: "PNG",
            function: () => {
              toPng(document.getElementById("canvas"), {
                pixelRatio: pngExportPixelRatio,
              }).then(function (dataUrl) {
                setExportData((prev) => ({
                  ...prev,
                  data: dataUrl,
                  extension: "png",
                }));
              });
              openExportModal(MODAL.IMG);
            },
          },
          {
            name: "JPEG",
            function: () => {
              toJpeg(document.getElementById("canvas"), { quality: 0.95 }).then(
                function (dataUrl) {
                  setExportData((prev) => ({
                    ...prev,
                    data: dataUrl,
                    extension: "jpeg",
                  }));
                },
              );
              openExportModal(MODAL.IMG);
            },
          },
          {
            name: "SVG",
            function: () => {
              const filter = (node) => node.tagName !== "i";
              toSvg(document.getElementById("canvas"), { filter: filter }).then(
                function (dataUrl) {
                  setExportData((prev) => ({
                    ...prev,
                    data: dataUrl,
                    extension: "svg",
                  }));
                },
              );
              openExportModal(MODAL.IMG);
            },
          },
          {
            name: "JSON",
            function: () => {
              openExportModal(MODAL.CODE);
              const result = JSON.stringify(
                {
                  tables: tables,
                  relationships: relationships,
                  notes: notes,
                  subjectAreas: areas,
                  database: database,
                  ...(databases[database].hasTypes && { types: types }),
                  ...(databases[database].hasEnums && { enums: enums }),
                  title: title,
                },
                null,
                2,
              );
              setExportData((prev) => ({
                ...prev,
                data: result,
                extension: "json",
              }));
            },
          },
          {
            name: "DBML",
            function: () => {
              openExportModal(MODAL.CODE);
              const result = toDBML({
                tables,
                relationships,
                enums,
                database,
              });
              setExportData((prev) => ({
                ...prev,
                data: result,
                extension: "dbml",
              }));
            },
          },
          {
            name: "PDF",
            function: () => {
              const canvas = document.getElementById("canvas");
              const filename = `${title}_${new Date().toISOString()}`;
              toJpeg(canvas).then(function (dataUrl) {
                const doc = new jsPDF("l", "px", [
                  canvas.offsetWidth,
                  canvas.offsetHeight,
                ]);
                doc.addImage(
                  dataUrl,
                  "jpeg",
                  0,
                  0,
                  canvas.offsetWidth,
                  canvas.offsetHeight,
                );
                doc.save(`${filename}.pdf`);
              });
            },
          },
          {
            name: "Mermaid",
            function: () => {
              openExportModal(MODAL.CODE);
              const result = jsonToMermaid({
                tables: tables,
                relationships: relationships,
                notes: notes,
                subjectAreas: areas,
                database: database,
                title: title,
              });
              setExportData((prev) => ({
                ...prev,
                data: result,
                extension: "md",
              }));
            },
          },
          {
            name: "Markdown",
            function: () => {
              openExportModal(MODAL.CODE);
              const result = jsonToDocumentation({
                tables: tables,
                relationships: relationships,
                notes: notes,
                subjectAreas: areas,
                database: database,
                title: title,
                ...(databases[database].hasTypes && { types: types }),
                ...(databases[database].hasEnums && { enums: enums }),
              });
              setExportData((prev) => ({
                ...prev,
                data: result,
                extension: "md",
              }));
            },
          },
        ],
        function: () => {},
      },
      exit: {
        function: () => {
          save();
          if (saveState === State.SAVED) navigate("/");
        },
      },
    },
    edit: {
      undo: {
        function: undo,
        shortcut: "Ctrl+Z",
        disabled: layout.readOnly || undoStack.length === 0,
      },
      redo: {
        function: redo,
        shortcut: "Ctrl+Y",
        disabled: layout.readOnly || redoStack.length === 0,
      },
      clear: {
        warning: {
          title: t("clear"),
          message: t("are_you_sure_clear"),
        },
        function: async () => {
          setTables([]);
          setRelationships([]);
          setAreas([]);
          setNotes([]);
          setEnums([]);
          setTypes([]);
          setUndoStack([]);
          setRedoStack([]);
        },
        disabled: layout.readOnly,
      },
      edit: {
        function: edit,
        shortcut: "Ctrl+E",
        disabled: layout.readOnly,
      },
      cut: {
        function: cut,
        shortcut: "Ctrl+X",
        disabled: layout.readOnly,
      },
      copy: {
        function: copy,
        shortcut: "Ctrl+C",
      },
      paste: {
        function: paste,
        shortcut: "Ctrl+V",
        disabled: layout.readOnly,
      },
      duplicate: {
        function: duplicate,
        shortcut: "Ctrl+D",
        disabled: layout.readOnly,
      },
      delete: {
        function: del,
        shortcut: "Del",
        disabled: layout.readOnly,
      },
      copy_as_image: {
        function: copyAsImage,
        shortcut: "Ctrl+Alt+C",
      },
    },
    view: {
      header: {
        state: layout.header ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setLayout((prev) => ({ ...prev, header: !prev.header })),
      },
      sidebar: {
        state: layout.sidebar ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setLayout((prev) => ({ ...prev, sidebar: !prev.sidebar })),
      },
      issues: {
        state: layout.issues ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setLayout((prev) => ({ ...prev, issues: !prev.issues })),
      },
      dbml_view: {
        state: layout.dbmlEditor ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: toggleDBMLEditor,
        shortcut: "Alt+E",
      },
      hide_issues: {
        state: settings.hideIssues ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: viewStrictMode,
        shortcut: "Ctrl+Shift+M",
      },
      presentation_mode: {
        function: () => {
          setLayout((prev) => ({
            ...prev,
            header: false,
            sidebar: false,
            toolbar: false,
          }));
          enterFullscreen();
        },
      },
      field_details: {
        state: settings.showFieldSummary ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: viewFieldSummary,
        shortcut: "Ctrl+Shift+F",
      },
      auto_arrange: {
        function: autoArrange,
        keywords: "layout tidy organise arrange",
      },
      show_versions: {
        function: () => setSidesheet(SIDESHEET.VERSIONS),
        keywords: "history revisions timeline",
      },
      fit_window: {
        function: fitWindow,
        shortcut: "Ctrl+Alt+W",
        keywords: "zoom fit all center",
      },
      reset_view: {
        function: resetView,
        shortcut: "Enter/Return",
      },
      show_comments: {
        state: settings.showComments ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setSettings((prev) => ({
            ...prev,
            showComments: !prev.showComments,
          })),
      },
      show_datatype: {
        state: settings.showDataTypes ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setSettings((prev) => ({
            ...prev,
            showDataTypes: !prev.showDataTypes,
          })),
      },
      show_grid: {
        state: settings.showGrid ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: viewGrid,
        shortcut: "Ctrl+Shift+G",
      },
      snap_to_grid: {
        state: settings.snapToGrid ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: snapToGrid,
      },
      show_cardinality: {
        state: settings.showCardinality ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setSettings((prev) => ({
            ...prev,
            showCardinality: !prev.showCardinality,
          })),
      },
      sketch_mode: {
        state: settings.sketchMode ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setSettings((prev) => ({
            ...prev,
            sketchMode: !prev.sketchMode,
          })),
      },
      show_relationship_labels: {
        state: settings.showRelationshipLabels ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setSettings((prev) => ({
            ...prev,
            showRelationshipLabels: !prev.showRelationshipLabels,
          })),
      },
      show_debug_coordinates: {
        state: settings.showDebugCoordinates ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setSettings((prev) => ({
            ...prev,
            showDebugCoordinates: !prev.showDebugCoordinates,
          })),
      },
      theme: {
        children: [
          {
            name: t("light"),
            function: () => setSettings((prev) => ({ ...prev, mode: "light" })),
          },
          {
            name: t("dark"),
            function: () => setSettings((prev) => ({ ...prev, mode: "dark" })),
          },
        ],
        function: () => {},
      },
      zoom_in: {
        function: zoomIn,
        shortcut: "Ctrl+(Up/Wheel)",
      },
      zoom_out: {
        function: zoomOut,
        shortcut: "Ctrl+(Down/Wheel)",
      },
      fullscreen: {
        state: fullscreen ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: fullscreen ? exitFullscreen : enterFullscreen,
      },
    },
    settings: {
      show_timeline: {
        function: () => setSidesheet(SIDESHEET.TIMELINE),
      },
      autosave: {
        state: settings.autosave ? (
          <i className="bi bi-toggle-on" />
        ) : (
          <i className="bi bi-toggle-off" />
        ),
        function: () =>
          setSettings((prev) => ({ ...prev, autosave: !prev.autosave })),
      },
      table_width: {
        function: () => setModal(MODAL.TABLE_WIDTH),
        disabled: layout.readOnly,
      },
      configure_custom_types: {
        function: () => setModal(MODAL.CONFIG_CUSTOM_TYPES),
        disabled: layout.readOnly,
      },
      language: {
        function: () => setModal(MODAL.LANGUAGE),
      },
      export_saved_data: {
        function: exportSavedData,
      },
      clear_cache: {
        function: () => {
          deleteFromCache(gistId);
          Toast.success(t("cache_cleared"));
        },
      },
      flush_storage: {
        warning: {
          title: t("flush_storage"),
          message: t("are_you_sure_flush_storage"),
        },
        function: async () => {
          localStorage.removeItem(STORAGE_KEY);
          db.delete()
            .then(() => {
              Toast.success(t("storage_flushed"));
              navigate("/editor", { replace: true });
              window.location.reload();
            })
            .catch(() => {
              Toast.error(t("oops_smth_went_wrong"));
            });
        },
      },
    },
    help: {
      docs: {
        function: () => window.open(`${socials.docs}`, "_blank"),
        shortcut: "Ctrl+H",
      },
      shortcuts: {
        function: () => window.open(`${socials.docs}/shortcuts`, "_blank"),
      },
      ask_on_discord: {
        function: () => window.open(socials.discord, "_blank"),
      },
      report_bug: {
        function: () => window.open("/bug-report", "_blank"),
      },
    },
  };

  // The palette replaces the menu bar, so it has to reach everything the menu
  // reached — plus the handful of actions that only ever lived on the toolbar
  // or a hotkey and were never in `menu` at all.
  //
  // Rebuilt every render rather than memoized: `menu` closes over roughly twenty
  // pieces of state, and a dependency list that misses one would leave the
  // palette showing a stale toggle or an action disabled after it became
  // available. `menu` itself is already rebuilt each render, so walking its ~70
  // entries adds nothing measurable.
  const commands = flattenMenu(menu, t);

  useHotkeys("mod+k", (e) => { e.preventDefault(); setPaletteOpen(true); }, {
    enableOnFormTags: true,
    preventDefault: true,
  });
  useHotkeys("mod+i", fileImport, { preventDefault: true });
  useHotkeys("mod+z", undo, { preventDefault: true });
  useHotkeys("mod+y", redo, { preventDefault: true });
  useHotkeys("mod+s", save, { preventDefault: true });
  useHotkeys("mod+o", open, { preventDefault: true });
  useHotkeys("mod+e", edit, { preventDefault: true });
  useHotkeys("mod+d", duplicate, { preventDefault: true });
  useHotkeys("mod+c", copy, { preventDefault: true });
  useHotkeys("mod+v", paste, { preventDefault: true });
  useHotkeys("mod+x", cut, { preventDefault: true });
  useHotkeys("delete", del, { preventDefault: true });
  useHotkeys("mod+shift+g", viewGrid, { preventDefault: true });
  useHotkeys("mod+up", zoomIn, { preventDefault: true });
  useHotkeys("mod+down", zoomOut, { preventDefault: true });
  useHotkeys("mod+shift+m", viewStrictMode, {
    preventDefault: true,
  });
  useHotkeys("mod+shift+f", viewFieldSummary, {
    preventDefault: true,
  });
  useHotkeys("mod+shift+s", saveDiagramAs, {
    preventDefault: true,
  });
  useHotkeys("mod+alt+c", copyAsImage, { preventDefault: true });
  useHotkeys("enter", resetView, { preventDefault: true });
  useHotkeys("mod+h", () => window.open(socials.docs, "_blank"), {
    preventDefault: true,
  });
  useHotkeys("mod+alt+w", fitWindow, { preventDefault: true });
  useHotkeys("alt+e", toggleDBMLEditor, { preventDefault: true });

  return (
    <>
      <div>
        {layout.header && (
          <DocIsland
            title={title}
            state={getState()}
            stateTitle={
              saveState === State.SAVED && savedAt()
                ? `${t("last_saved")} ${savedAt()
                    .setLocale(i18n.language)
                    .toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS)}`
                : undefined
            }
            saving={saveState === State.SAVING || saveState === State.LOADING}
            onRename={() => !layout.readOnly && setModal(MODAL.RENAME)}
            onMenu={() => setPaletteOpen(true)}
            onShare={() => setModal(MODAL.SHARE)}
            showShare={!isTemplate}
          />
        )}
        {layout.toolbar && (
          <ZoomIsland
            onUndo={undo}
            onRedo={redo}
            canUndo={undoStack.length > 0 && !layout.readOnly}
            canRedo={redoStack.length > 0 && !layout.readOnly}
            onResetZoom={fitWindow}
          />
        )}
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
      <Modal
        modal={modal}
        exportData={exportData}
        setExportData={setExportData}
        title={title}
        setTitle={setTitle}
        setModal={setModal}
        importFrom={importFrom}
        importDb={importDb}
        saveAsCopy={saveAsCopy}
      />
      <Sidesheet
        type={sidesheet}
        title={title}
        setTitle={setTitle}
        onClose={() => setSidesheet(SIDESHEET.NONE)}
      />
      <ConfigureCustomTypes
        open={modal === MODAL.CONFIG_CUSTOM_TYPES}
        onClose={() => setModal(MODAL.NONE)}
      />
    </>
  );


  function getState() {
    switch (saveState) {
      case State.NONE:
        return t("no_changes");
      case State.LOADING:
        return t("loading");
      case State.SAVED:
        return savedLabel();
      case State.SAVING:
        return t("saving");
      case State.ERROR:
        return t("failed_to_save");
      case State.FAILED_TO_LOAD:
        return t("failed_to_load");
      default:
        return "";
    }
  }

  /**
   * The doc island's state line gets ~156px on a 390px phone. The absolute
   * stamp this used to print — "Last saved 7/26/2026, 12:13:49 PM" — measured
   * 217px and was cut a quarter of the way in, to "…7/26/2026, 10:0…", which is
   * both ugly and unreadable. A relative time fits, and answers the question
   * you actually have ("is my work in?") rather than making you subtract dates.
   * The exact instant is still there in the title attribute.
   */
  function savedLabel() {
    const at = savedAt();
    if (!at) return t("saved_just_now");
    // Under a minute luxon says "0 minutes ago" / "in 0 seconds"; say it plainly.
    if (Math.abs(at.diffNow("seconds").seconds) < 45) return t("saved_just_now");
    return t("saved_relative", {
      time: at.setLocale(i18n.language).toRelative(),
    });
  }

  function savedAt() {
    if (!lastSaved) return null;
    const at =
      lastSaved instanceof Date
        ? DateTime.fromJSDate(lastSaved)
        : DateTime.fromJSDate(new Date(lastSaved));
    return at.isValid ? at : null;
  }

}
