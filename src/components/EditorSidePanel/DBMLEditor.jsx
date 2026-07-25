import { useEffect, useState } from "react";
import { useDiagram, useEnums } from "../../hooks";
import { toDBML } from "../../utils/exportAs/dbml";
import CodeEditor from "../CodeEditor";

export default function DBMLEditor() {
  const { tables: currentTables, relationships, database } = useDiagram();
  const { enums } = useEnums();
  // Same shape as the effect below, which replaces this on mount anyway — the
  // initial value only exists so the first paint is not blank.
  const [value, setValue] = useState(() =>
    toDBML({ tables: currentTables, enums, relationships, database }),
  );

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
      height="100%"
      options={{
        readOnly: true,
        minimap: { enabled: false },
      }}
    />
  );
}
