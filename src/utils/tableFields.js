import { nanoid } from "nanoid";
import { Action, ObjectType } from "../data/constants";

/**
 * Appends a blank field to a table and records it on the undo stack.
 *
 * Shared because two places need it: the Add field button, and pressing Enter
 * on the last field's name — typing a schema should not require reaching for
 * the mouse between every row.
 *
 * @returns the new field's id, so the caller can move focus to it.
 */
export function appendField({ table, updateTable, setUndoStack, setRedoStack, t }) {
  const id = nanoid();

  setUndoStack((prev) => [
    ...prev,
    {
      action: Action.EDIT,
      element: ObjectType.TABLE,
      component: "field_add",
      tid: table.id,
      fid: id,
      message: t("edit_table", {
        tableName: table.name,
        extra: "[add field]",
      }),
    },
  ]);
  setRedoStack([]);

  updateTable(table.id, {
    fields: [
      ...table.fields,
      {
        id,
        name: "",
        type: "",
        default: "",
        check: "",
        primary: false,
        unique: false,
        notNull: false,
        increment: false,
        comment: "",
      },
    ],
  });

  return id;
}

/**
 * Moves focus to a field-name input in the side panel by row index. The inputs
 * are addressed by the id TableField renders; a newly appended row has not been
 * painted yet when the caller asks, so retry across a couple of frames rather
 * than guessing a timeout.
 */
export function focusFieldName(tid, index, attempts = 4) {
  const target = () => document.getElementById(`scroll_table_${tid}_input_${index}`);
  const tryFocus = (remaining) => {
    const el = target();
    if (el) {
      el.focus();
      if (typeof el.select === "function") el.select();
      return;
    }
    if (remaining > 0) requestAnimationFrame(() => tryFocus(remaining - 1));
  };
  tryFocus(attempts);
}
