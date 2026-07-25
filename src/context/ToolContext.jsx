import { createContext, useState } from "react";

/**
 * The canvas tools. `select` is the resting state (normal selection and pan);
 * every other value means the canvas is *armed* and the next click on empty
 * canvas does something other than select.
 */
export const Tool = {
  SELECT: "select",
  TABLE: "table",
  RELATIONSHIP: "relationship",
  NOTE: "note",
  AREA: "area",
};

/**
 * Tools whose next canvas click drops a new object at that point. `relationship`
 * is deliberately not one of them: a relationship needs a start *field*, so it
 * is armed from a field grip rather than from empty canvas.
 */
export const placementTools = [Tool.TABLE, Tool.NOTE, Tool.AREA];

export const isPlacementTool = (tool) => placementTools.includes(tool);

export const ToolContext = createContext(null);

export default function ToolContextProvider({ children }) {
  const [tool, setTool] = useState(Tool.SELECT);

  return (
    <ToolContext.Provider value={{ tool, setTool }}>
      {children}
    </ToolContext.Provider>
  );
}
