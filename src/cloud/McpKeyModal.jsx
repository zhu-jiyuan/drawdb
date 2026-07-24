import { useEffect, useState } from "react";
import { Banner, Button, Input, Modal, Popconfirm, Spin, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { getMcpKeyStatus, generateMcpKey, revokeMcpKey } from "./api";

// Self-service management of the MCP API key (used by AI assistants through
// the bundled mcp/ server). The plaintext key is shown exactly once after
// generation — only its hash is stored server-side.
export default function McpKeyModal({ visible, onClose }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null); // null = loading
  const [freshKey, setFreshKey] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStatus(null);
    setFreshKey(null);
    getMcpKeyStatus()
      .then((res) => setStatus(res.data))
      .catch(() => {
        Toast.error(t("oops_smth_went_wrong"));
        onClose();
      });
  }, [visible, t, onClose]);

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const { data } = await generateMcpKey();
      setFreshKey(data.key);
      const { data: st } = await getMcpKeyStatus();
      setStatus(st);
    } catch {
      Toast.error(t("oops_smth_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    setBusy(true);
    try {
      await revokeMcpKey();
      setFreshKey(null);
      const { data: st } = await getMcpKeyStatus();
      setStatus(st);
      Toast.success(t("cloud_mcp_key_revoked"));
    } catch {
      Toast.error(t("oops_smth_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(freshKey);
      Toast.success(t("copied_to_clipboard"));
    } catch {
      Toast.error(t("oops_smth_went_wrong"));
    }
  };

  return (
    <Modal
      centered
      width={"min(448px, 94vw)"}
      visible={visible}
      title={t("cloud_mcp_key_title")}
      footer={null}
      onCancel={onClose}
      maskClosable={!freshKey}
    >
      {status === null ? (
        <div className="flex justify-center py-8">
          <Spin />
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          <div className="text-sm text-zinc-500">{t("cloud_mcp_key_desc")}</div>

          {freshKey && (
            <div className="space-y-2">
              <Banner
                fullMode={false}
                type="warning"
                closeIcon={null}
                description={t("cloud_mcp_key_once")}
              />
              <div className="flex gap-2">
                <Input readOnly value={freshKey} />
                <Button theme="solid" onClick={copyKey}>
                  {t("copy")}
                </Button>
              </div>
            </div>
          )}

          {status.exists ? (
            <div className="text-sm">
              <div>
                {t("cloud_mcp_key_created", {
                  time: new Date(status.createdAt).toLocaleString(),
                })}
              </div>
              <div>
                {status.lastUsedAt
                  ? t("cloud_mcp_key_last_used", {
                      time: new Date(status.lastUsedAt).toLocaleString(),
                    })
                  : t("cloud_mcp_key_never_used")}
              </div>
            </div>
          ) : (
            <div className="text-sm">{t("cloud_mcp_key_none")}</div>
          )}

          <div className="flex justify-end gap-2">
            {status.exists && (
              <Popconfirm
                title={t("cloud_mcp_key_revoke")}
                content={t("cloud_mcp_key_revoke_confirm")}
                okText={t("confirm")}
                cancelText={t("cancel")}
                onConfirm={handleRevoke}
              >
                <Button type="danger" loading={busy}>
                  {t("cloud_mcp_key_revoke")}
                </Button>
              </Popconfirm>
            )}
            <Button theme="solid" loading={busy} onClick={handleGenerate}>
              {status.exists
                ? t("cloud_mcp_key_regenerate")
                : t("cloud_mcp_key_generate")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
