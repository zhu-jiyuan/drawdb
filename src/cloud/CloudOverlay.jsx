import { useEffect, useRef, useState } from "react";
import { Button, Dropdown, Input, Modal, Toast } from "@douyinfe/semi-ui";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { useMatch, useNavigate } from "react-router-dom";
import { db } from "../data/db";
import { State } from "../data/constants";
import { useSaveState } from "../hooks";
import { exportSavedData } from "../utils/exportSavedData";
import { login, logout } from "./api";
import {
  subscribeSync,
  getSyncState,
  resolveConflict,
  checkFresh,
  clearFresh,
  uploadLocalDiagrams,
} from "./sync";
import { useCloudAuth } from "./authContext";

const FRESH_CHECK_MIN_INTERVAL = 10_000;

export default function CloudOverlay() {
  const auth = useCloudAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (auth.status === "anon") {
    return (
      <div className="pointer-events-auto absolute bottom-3 left-3 z-20 md:bottom-24">
        <Button
          size="small"
          icon={<i className="bi bi-cloud me-1" />}
          onClick={() => navigate("/login")}
        >
          {t("cloud_login")}
        </Button>
      </div>
    );
  }

  if (auth.status !== "cloud") return null;

  return <CloudControls />;
}

function CloudControls() {
  const auth = useCloudAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { saveState, setSaveState } = useSaveState();
  const [sync, setSync] = useState(() => ({ ...getSyncState() }));
  const [showMigrate, setShowMigrate] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const localCount = useLiveQuery(() => db.diagrams.count(), [], 0);
  const diagramMatch = useMatch("/editor/diagrams/:id");
  const diagramId = diagramMatch?.params?.id;
  const lastFreshCheck = useRef(0);

  useEffect(() => subscribeSync(setSync), []);

  // when another device saved a newer version, notice it on tab focus
  useEffect(() => {
    const check = () => {
      if (!diagramId || saveState !== State.SAVED) return;
      const now = Date.now();
      if (now - lastFreshCheck.current < FRESH_CHECK_MIN_INTERVAL) return;
      lastFreshCheck.current = now;
      checkFresh(diagramId).catch(() => {});
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [diagramId, saveState]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // clearing the local session is enough either way
    }
    auth.onLoggedOut();
    window.location.href = "/";
  };

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      await exportSavedData();
      const result = await uploadLocalDiagrams();
      await db.diagrams.clear();
      Toast.success(t("cloud_upload_done", result));
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error(err);
      Toast.error(t("oops_smth_went_wrong"));
      setMigrating(false);
    }
  };

  const handleConflict = async (choice) => {
    setResolving(true);
    try {
      await resolveConflict(choice);
      if (choice === "theirs") {
        window.location.reload();
        return;
      }
      setSaveState(State.SAVED);
    } catch (err) {
      console.error(err);
      Toast.error(t("oops_smth_went_wrong"));
    } finally {
      setResolving(false);
    }
  };

  const conflictTime = sync.conflict
    ? new Date(sync.conflict.server.lastModified).toLocaleString()
    : "";
  const conflictName = sync.conflict?.server?.name ?? "";

  const showFresh =
    sync.freshVersion && sync.freshVersion.diagramId === diagramId;

  return (
    <>
      <div className="pointer-events-auto absolute bottom-3 left-3 z-20 md:bottom-24">
        <Dropdown
          position="topLeft"
          render={
            <Dropdown.Menu>
              {localCount > 0 && (
                <Dropdown.Item onClick={() => setShowMigrate(true)}>
                  <i className="bi bi-cloud-upload me-2" />
                  {t("cloud_upload_local", { count: localCount })}
                </Dropdown.Item>
              )}
              <Dropdown.Item onClick={handleLogout}>
                <i className="bi bi-box-arrow-right me-2" />
                {t("cloud_logout")}
              </Dropdown.Item>
            </Dropdown.Menu>
          }
        >
          <div className="flex cursor-pointer select-none items-center gap-2 rounded-full border border-[var(--semi-color-border)] bg-[var(--semi-color-bg-2)] px-3 py-1 text-xs text-[var(--semi-color-text-0)] shadow-md">
            <StatusIcon sync={sync} />
            <StatusLabel sync={sync} t={t} />
          </div>
        </Dropdown>
      </div>

      {sync.deletedRemotely === diagramId && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-red-300 bg-red-50 px-5 py-1.5 shadow-md">
            <i className="bi bi-exclamation-triangle text-red-600" />
            <span className="text-sm">{t("cloud_deleted_remotely")}</span>
            <Button size="small" theme="solid" onClick={() => navigate("/")}>
              {t("cloud_recent_title")}
            </Button>
          </div>
        </div>
      )}

      {showFresh && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-blue-300 bg-blue-50 px-5 py-1.5 shadow-md dark:border-sky-900/50 dark:bg-sky-900/30">
            <i className="bi bi-cloud-arrow-down" />
            <span className="text-sm">{t("cloud_fresh_banner")}</span>
            <Button
              size="small"
              theme="solid"
              onClick={() => window.location.reload()}
            >
              {t("cloud_fresh_load")}
            </Button>
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              aria-label="Dismiss"
              icon={<i className="bi bi-x-lg" />}
              onClick={clearFresh}
            />
          </div>
        </div>
      )}

      <Modal
        centered
        width={"min(448px, 94vw)"}
        closable={false}
        maskClosable={false}
        visible={!!sync.conflict}
        title={t("cloud_conflict_title")}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              loading={resolving}
              onClick={() => handleConflict("mine")}
            >
              {t("cloud_keep_mine")}
            </Button>
            <Button
              theme="solid"
              loading={resolving}
              onClick={() => handleConflict("theirs")}
            >
              {t("cloud_use_server")}
            </Button>
          </div>
        }
      >
        {t("cloud_conflict_desc", { time: conflictTime, name: conflictName })}
      </Modal>

      <Modal
        centered
        width={"min(448px, 94vw)"}
        visible={showMigrate}
        title={t("cloud_upload_local", { count: localCount })}
        okText={t("confirm")}
        cancelText={t("cancel")}
        confirmLoading={migrating}
        onOk={handleMigrate}
        onCancel={() => !migrating && setShowMigrate(false)}
      >
        {t("cloud_upload_local_desc", { count: localCount })}
      </Modal>

      <ReloginModal />
    </>
  );
}

function StatusIcon({ sync }) {
  if (sync.conflict) return <i className="bi bi-cloud-slash text-red-500" />;
  if (sync.offline) return <i className="bi bi-cloud-slash text-zinc-400" />;
  if (sync.pending > 0)
    return <i className="bi bi-cloud-arrow-up text-amber-500" />;
  return <i className="bi bi-cloud-check text-emerald-500" />;
}

function StatusLabel({ sync, t }) {
  if (sync.conflict) return t("cloud_status_conflict");
  if (sync.offline) return t("cloud_status_offline");
  if (sync.pending > 0) return t("cloud_status_pending", { count: sync.pending });
  return t("cloud_status_synced");
}

function ReloginModal() {
  const auth = useCloudAuth();
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleLogin = async () => {
    if (!password) return;
    setBusy(true);
    try {
      await login(password);
      setPassword("");
      auth.onLoggedIn();
    } catch (err) {
      Toast.error(
        err?.response?.status === 429
          ? t("cloud_too_many_attempts")
          : t("cloud_login_failed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      centered
      width={"min(448px, 94vw)"}
      closable={false}
      maskClosable={false}
      visible={auth.expired}
      title={t("cloud_session_expired")}
      footer={
        <Button theme="solid" loading={busy} onClick={handleLogin}>
          {t("cloud_login")}
        </Button>
      }
    >
      <Input
        mode="password"
        placeholder={t("cloud_password")}
        value={password}
        onChange={(v) => setPassword(v)}
        onEnterPress={handleLogin}
      />
    </Modal>
  );
}
