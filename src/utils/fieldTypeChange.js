import { resolveType } from "./customTypes";

// The side effects of changing a field's type — clearing or defaulting size,
// values, default and increment depending on what the new type supports.
// Single source for the side panel's type Select and the canvas inline editor.
export function fieldUpdatesForTypeChange(database, field, value) {
  const typeInfo = resolveType(database, value);
  const incr = field.increment && !!typeInfo.canIncrement;

  if (value === "ENUM" || value === "SET") {
    return {
      type: value,
      default: "",
      values: field.values ? [...field.values] : [],
      increment: incr,
    };
  } else if (typeInfo.isSized || typeInfo.hasPrecision) {
    return { type: value, size: typeInfo.defaultSize, increment: incr };
  } else if (!typeInfo.hasDefault || incr) {
    return {
      type: value,
      increment: incr,
      default: "",
      size: "",
      values: [],
    };
  } else if (typeInfo.hasCheck) {
    return { type: value, check: "", increment: incr };
  }
  return { type: value, increment: incr, size: "", values: [] };
}
