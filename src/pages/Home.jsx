import { useEffect, useState } from "react";
import { Button, Spin, Tag } from "@douyinfe/semi-ui";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { db } from "../data/db";
import {
  mergeDiagrams,
  sortDiagrams,
  formatSize,
  databaseName,
} from "../components/EditorHeader/Modal/Open/diagram";
import { cloudList } from "../cloud/sync";
import { useCloudAuth } from "../cloud/authContext";
import Login from "./Login";
import logo from "../assets/logo_light_160.png";

// The personal-fork homepage: the login form until authenticated, then the
// recent-diagrams list. The stock landing page is unrouted.
export default function Home() {
  const auth = useCloudAuth();
  if (auth.status !== "cloud" || auth.expired) return <Login />;
  return <RecentDiagrams />;
}

function RecentDiagrams() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [cloud, setCloud] = useState(null); // null = loading
  const [error, setError] = useState(false);
  const local = useLiveQuery(() => db.diagrams.toArray(), [], []);

  useEffect(() => {
    document.title = "drawDB";
    let cancelled = false;
    cloudList()
      .then((items) => !cancelled && setCloud(items))
      .catch(() => {
        if (!cancelled) {
          setCloud([]);
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = cloud === null;
  const entries = loading
    ? []
    : sortDiagrams(mergeDiagrams(cloud, local ?? []), {
        key: "lastModified",
        dir: "desc",
      });

  return (
    <div className="min-h-screen bg-zinc-100 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between pt-4">
          <img src={logo} alt="drawDB" className="h-9" />
          <Button
            theme="solid"
            icon={<i className="bi bi-plus-lg me-1" />}
            onClick={() => navigate("/editor")}
          >
            {t("cloud_new_diagram")}
          </Button>
        </div>

        <div className="text-lg font-semibold">{t("cloud_recent_title")}</div>

        {error && (
          <div className="text-sm text-amber-600">{t("cloud_unavailable")}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Spin size="large" />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-16 text-center text-zinc-500">
            {t("cloud_no_diagrams")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            {entries.map((entry) => (
              <button
                key={`${entry.source}:${entry.diagramId}`}
                className="flex w-full items-center gap-4 border-b border-zinc-100 px-5 py-3.5 text-left last:border-b-0 hover:bg-zinc-50"
                onClick={() => navigate(`/editor/diagrams/${entry.diagramId}`)}
              >
                <i className="bi bi-diagram-3 text-lg text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {entry.name || "Untitled diagram"}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {databaseName(entry.database)}
                    {" · "}
                    {formatSize(entry.size)}
                    {entry.lastModified
                      ? ` · ${entry.lastModified.toLocaleString()}`
                      : ""}
                  </div>
                </div>
                {entry.source === "local" && (
                  <Tag size="small" color="amber">
                    {t("cloud_source_local")}
                  </Tag>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
