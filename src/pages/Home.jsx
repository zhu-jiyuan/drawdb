import { useEffect, useState } from "react";
import { Button, Popconfirm, Spin, Tag, Toast } from "@douyinfe/semi-ui";
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
import { cloudList, cloudDelete } from "../cloud/sync";
import { useCloudAuth } from "../cloud/authContext";
import McpKeyModal from "../cloud/McpKeyModal";
import Login from "./Login";
import logoLight from "../assets/logo_light_160.png";
import logoDark from "../assets/logo_dark_160.png";

// The personal-fork homepage: the login form until authenticated, then the
// recent-diagrams list. The stock landing page is unrouted.
export default function Home() {
  const auth = useCloudAuth();
  // The editor mounts its own SettingsContext, so the dark-mode choice it
  // persists isn't reflected by the app-level provider wrapping this page.
  // Apply the persisted theme directly so the homepage matches the editor.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("settings") || "{}");
      if (saved.mode) document.body.setAttribute("theme-mode", saved.mode);
    } catch {
      // ignore malformed settings
    }
  }, []);
  if (auth.status !== "cloud" || auth.expired) return <Login />;
  return <RecentDiagrams />;
}

function RecentDiagrams() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [cloud, setCloud] = useState(null); // null = loading
  const [error, setError] = useState(false);
  const [showMcpKey, setShowMcpKey] = useState(false);
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

  const onDelete = async (entry) => {
    try {
      if (entry.source === "cloud") {
        await cloudDelete(entry.diagramId);
        setCloud((prev) =>
          (prev ?? []).filter((d) => d.diagramId !== entry.diagramId),
        );
      } else {
        // local-only row: leave any same-id cloud copy alone
        await db.diagrams.where("diagramId").equals(entry.diagramId).delete();
      }
    } catch (err) {
      console.error(err);
      Toast.error(t("oops_smth_went_wrong"));
    }
  };

  return (
    <div className="min-h-screen bg-[var(--semi-color-bg-1)] text-[var(--semi-color-text-0)] p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <img src={
            document.body.getAttribute("theme-mode") === "dark"
              ? logoDark
              : logoLight
          } alt="drawDB" className="h-9" />
          <div className="flex gap-2">
            <Button
              icon={<i className="bi bi-key me-1" />}
              onClick={() => setShowMcpKey(true)}
            >
              {t("cloud_mcp_key_title")}
            </Button>
            <Button
              theme="solid"
              icon={<i className="bi bi-plus-lg me-1" />}
              onClick={() => navigate("/editor")}
            >
              {t("cloud_new_diagram")}
            </Button>
          </div>
        </div>

        <McpKeyModal visible={showMcpKey} onClose={() => setShowMcpKey(false)} />

        <div className="text-lg font-semibold">{t("cloud_recent_title")}</div>

        {error && (
          <div className="text-sm text-amber-600">{t("cloud_unavailable")}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Spin size="large" />
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--semi-color-border)] bg-[var(--semi-color-bg-2)] py-16 text-center text-zinc-500">
            {t("cloud_no_diagrams")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--semi-color-border)] bg-[var(--semi-color-bg-2)] shadow-sm">
            {entries.map((entry) => (
              <div
                key={`${entry.source}:${entry.diagramId}`}
                className="flex w-full cursor-pointer items-center gap-4 border-b border-[var(--semi-color-border)] px-5 py-3.5 text-left last:border-b-0 hover:bg-[var(--semi-color-fill-0)]"
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
                <span onClick={(e) => e.stopPropagation()}>
                  <Popconfirm
                    title={t("delete_diagram")}
                    content={t("are_you_sure_delete_diagram")}
                    okText={t("confirm")}
                    cancelText={t("cancel")}
                    position="left"
                    onConfirm={() => onDelete(entry)}
                  >
                    <Button
                      size="small"
                      type="danger"
                      theme="borderless"
                      aria-label={t("delete_diagram")}
                      icon={<i className="bi bi-trash" />}
                    />
                  </Popconfirm>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
