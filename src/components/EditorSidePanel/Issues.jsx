import { useState, useEffect } from "react";
import { Collapse, Badge } from "@douyinfe/semi-ui";
import { arrayIsEqual } from "../../utils/utils";
import { getIssues } from "../../utils/issues";
import { useEnums, useSettings, useDiagram, useTypes } from "../../hooks";
import { useTranslation } from "react-i18next";

export default function Issues() {
  const { types } = useTypes();
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { enums } = useEnums();
  const { tables, relationships, database } = useDiagram();
  const [issues, setIssues] = useState([]);

  useEffect(() => {
    const findIssues = async () => {
      const newIssues = getIssues({
        tables: tables,
        relationships: relationships,
        types: types,
        database: database,
        enums: enums,
      });

      // Compare inside the updater: depending on `issues` here made this
      // effect re-run on its own output, walking every table twice per change.
      setIssues((prev) => (arrayIsEqual(newIssues, prev) ? prev : newIssues));
    };

    findIssues();
  }, [tables, relationships, types, database, enums]);

  return (
    <Collapse lazyRender keepDOM={false} style={{ width: "100%" }}>
      <Collapse.Panel
        header={
          <Badge
            type={issues.length > 0 ? "danger" : "primary"}
            count={settings.hideIssues ? null : issues.length}
            overflowCount={99}
            className="mt-1"
          >
            <div className="pe-3 select-none">
              <i className="fa-solid fa-triangle-exclamation me-2 text-yellow-500" />
              {t("issues")}
            </div>
          </Badge>
        }
        itemKey="1"
      >
        <div className="max-h-[160px] overflow-y-auto">
          {settings.hideIssues ? (
            <div className="mb-1">{t("issues_hidden")}</div>
          ) : issues.length > 0 ? (
            <>
              {issues.map((e, i) => (
                <div key={i} className="py-2">
                  {e}
                </div>
              ))}
            </>
          ) : (
            <div>{t("no_issues")}</div>
          )}
        </div>
      </Collapse.Panel>
    </Collapse>
  );
}
