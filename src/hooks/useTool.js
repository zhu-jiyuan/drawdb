import { useContext } from "react";
import { ToolContext } from "../context/ToolContext";

export default function useTool() {
  return useContext(ToolContext);
}
