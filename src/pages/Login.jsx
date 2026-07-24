import { useEffect, useState } from "react";
import { Button, Input, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import logo from "../assets/logo_light_160.png";
import { login } from "../cloud/api";
import { useCloudAuth } from "../cloud/authContext";

export default function Login() {
  const auth = useCloudAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Log in | drawDB";
  }, []);

  useEffect(() => {
    if (auth.status === "cloud" && !auth.expired) {
      navigate("/editor", { replace: true });
    }
  }, [auth.status, auth.expired, navigate]);

  const handleLogin = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      await login(password);
      auth.onLoggedIn();
      navigate("/editor", { replace: true });
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <img src={logo} alt="drawDB" className="mx-auto h-10" />
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
