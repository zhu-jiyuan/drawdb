import { useEffect, useState } from "react";
import { Button, Input, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import logoLight from "../assets/logo_light_160.png";
import logoDark from "../assets/logo_dark_160.png";
import { login } from "../cloud/api";
import { useCloudAuth } from "../cloud/authContext";

export default function Login() {
  const auth = useCloudAuth();
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Log in | drawDB";
  }, []);

  const handleLogin = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      await login(password);
      // No navigation: Home switches to the recent-diagrams list when the
      // auth status flips.
      auth.onLoggedIn();
    } catch (err) {
      Toast.error(
        err?.response?.status === 429
          ? t("cloud_too_many_attempts")
          : t("cloud_login_failed"),
      );
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--semi-color-bg-1)] text-[var(--semi-color-text-0)] p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-[var(--semi-color-border)] bg-[var(--semi-color-bg-2)] p-8 shadow-sm">
        <img src={
            document.body.getAttribute("theme-mode") === "dark"
              ? logoDark
              : logoLight
          } alt="drawDB" className="mx-auto h-10" />
        <div className="text-center text-lg font-semibold">
          {t("cloud_login")}
        </div>
        {auth.status === "off" ? (
          <div className="text-center text-sm text-zinc-500">
            {t("cloud_unavailable")}
          </div>
        ) : (
          <>
            <Input
              mode="password"
              size="large"
              placeholder={t("cloud_password")}
              value={password}
              onChange={(v) => setPassword(v)}
              onEnterPress={handleLogin}
              autoFocus
            />
            <Button
              block
              size="large"
              theme="solid"
              loading={busy}
              onClick={handleLogin}
            >
              {t("cloud_login")}
            </Button>
          </>
        )}
        <div className="text-center">
          <Link
            to="/editor"
            className="text-sm text-blue-600 hover:underline"
          >
            {t("cloud_use_local_only")}
          </Link>
        </div>
      </div>
    </div>
  );
}
