export const defaultBlue = "#6965db";
export const defaultNoteTheme = "#fcf7ac";
export const noteWidth = 180;
export const noteRadius = 3;
export const noteFold = 24;
export const darkBgTheme = "#16161A";
// Type-label palette. Rendered as chips (pale wash + deep ink), so each entry
// carries the hue for the background and an ink colour dark enough to clear
// WCAG AA on that wash — the plain saturated colours used before sat at
// 3.3-4.4:1 on paper, which was the readability problem.
export const typeColors = {
  string: { hue: "#e8590c", ink: "#a03800" },
  int: { hue: "#1971c2", ink: "#12507f" },
  decimal: { hue: "#2f9e44", ink: "#1d6b2d" },
  boolean: { hue: "#6741d9", ink: "#4a2ea8" },
  binary: { hue: "#087f5b", ink: "#0a5c44" },
  enumSet: { hue: "#1098ad", ink: "#0a5f6d" },
  document: { hue: "#5f3dc4", ink: "#452b91" },
  networkId: { hue: "#e03131", ink: "#a51f1f" },
  geometric: { hue: "#ae3ec9", ink: "#7c2b90" },
  vector: { hue: "#495057", ink: "#343a40" },
  other: { hue: "#868e96", ink: "#495057" },
  date: { hue: "#0c8599", ink: "#08616f" },
};

export const stringColor = typeColors.string.hue;
export const intColor = typeColors.int.hue;
export const decimalColor = typeColors.decimal.hue;
export const booleanColor = typeColors.boolean.hue;
export const binaryColor = typeColors.binary.hue;
export const enumSetColor = typeColors.enumSet.hue;
export const documentColor = typeColors.document.hue;
export const networkIdColor = typeColors.networkId.hue;
export const geometricColor = typeColors.geometric.hue;
export const vectorColor = typeColors.vector.hue;
export const otherColor = typeColors.other.hue;
export const dateColor = typeColors.date.hue;

// Ink lookup by hue, so a resolved type colour maps to its readable text tone.
export const typeInk = Object.fromEntries(
  Object.values(typeColors).map((c) => [c.hue.toLowerCase(), c.ink]),
);

export const tableHeaderHeight = 56;
export const tableWidth = 240;
export const gridSize = 24;
export const gridCircleRadius = 0.85;
export const tableFieldHeight = 40;
export const tableColorStripHeight = 7;
export const pngExportPixelRatio = 4;
export const minAreaSize = 120;

export const Cardinality = {
  ONE_TO_ONE: "one_to_one",
  ONE_TO_MANY: "one_to_many",
  MANY_TO_ONE: "many_to_one",
};

export const Constraint = {
  NONE: "No action",
  RESTRICT: "Restrict",
  CASCADE: "Cascade",
  SET_NULL: "Set null",
  SET_DEFAULT: "Set default",
};

export const Tab = {
  TABLES: "1",
  RELATIONSHIPS: "2",
  AREAS: "3",
  NOTES: "4",
  TYPES: "5",
  ENUMS: "6",
};

export const ObjectType = {
  NONE: 0,
  TABLE: 1,
  AREA: 2,
  NOTE: 3,
  RELATIONSHIP: 4,
  TYPE: 5,
  ENUM: 6,
};

export const Action = {
  ADD: 0,
  MOVE: 1,
  DELETE: 2,
  EDIT: 3,
};

export const State = {
  NONE: 0,
  SAVING: 1,
  SAVED: 2,
  LOADING: 3,
  ERROR: 4,
  FAILED_TO_LOAD: 5,
};

export const MODAL = {
  NONE: 0,
  IMG: 1,
  CODE: 2,
  IMPORT: 3,
  RENAME: 4,
  OPEN: 5,
  SAVEAS: 6,
  NEW: 7,
  IMPORT_SRC: 8,
  TABLE_WIDTH: 9,
  LANGUAGE: 10,
  SHARE: 11,
  CONFIG_CUSTOM_TYPES: 12,
};

export const STATUS = {
  NONE: 0,
  WARNING: 1,
  ERROR: 2,
  OK: 3,
};

export const SIDESHEET = {
  NONE: 0,
  TIMELINE: 1,
  VERSIONS: 2,
};

export const DB = {
  MYSQL: "mysql",
  POSTGRES: "postgresql",
  MSSQL: "transactsql",
  SQLITE: "sqlite",
  MARIADB: "mariadb",
  ORACLESQL: "oraclesql",
  GENERIC: "generic",
};

export const IMPORT_FROM = {
  JSON: 0,
  DBML: 1,
};
