import { useEffect, useState } from "react";
import { useDiagram, useEnums } from "../../hooks";
import { toDBML } from "../../utils/exportAs/dbml";
import CodeEditor from "../CodeEditor";

export default function DBMLEditor() {
  const { tables: currentTables, relationships, database } = useDiagram();
  const diagram = useDiagram();
  const { enums } = useEnums();
  const [value, setValue] = useState(() => toDBML({ ...diagram, enums }));

  useEffect(() => {
    // `database` is required: without it toDBML can't resolve type metadata and
    // silently drops every size/precision and default quoting.
    setValue(toDBML({ tables: currentTables, enums, relationships, database }));
  }, [currentTables, enums, relationships, database]);

  return (
    <CodeEditor
      showCopyButton
      value={value}
      language="dbml"
      onChange={setValue}
      height="100%"
      options={{
        readOnly: true,
        minimap: { enabled: false },
      }}
    />
  );
}
