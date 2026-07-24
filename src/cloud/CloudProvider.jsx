import { useCallback, useEffect, useMemo, useState } from "react";
import ExtensionsContext from "../context/ExtensionsContext";
import { CloudAuthContext } from "./authContext";
import { db } from "../data/db";
import { me } from "./api";
import {
  cloudSave,
  cloudLoad,
  cloudList,
  cloudDelete,
  flushOutbox,
  wireBackgroundSync,
} from "./sync";
import CloudOverlay from "./CloudOverlay";

export default function CloudProvider({ children }) {
  const [status, setStatus] = useState("loading");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    me({ timeout: 5000 })
      .then(() => !cancelled && setStatus("cloud"))
      .catch(async (err) => {
        if (cancelled) return;
        if (err?.response?.status === 401) {
          setStatus("anon");
          return;
        }
        // Backend unreachable. If cloud diagrams are mirrored locally, mount
        // the extensions anyway: loads come from the mirror, saves queue in
        // the outbox, and an invalid session surfaces as a re-login dialog on
        // the first request that gets through.
        const mirrored = await db.cloudMirror.count().catch(() => 0);
        if (!cancelled) setStatus(mirrored > 0 ? "cloud" : "off");
      });

    const onUnauthorized = () => setExpired(true);
    window.addEventListener("cloud:unauthorized", onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener("cloud:unauthorized", onUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (status !== "cloud") return;
    wireBackgroundSync();
    flushOutbox();
  }, [status]);

  const onLoggedIn = useCallback(() => {
    setStatus("cloud");
    setExpired(false);
    flushOutbox();
  }, []);

  const onLoggedOut = useCallback(() => {
    setStatus("anon");
    setExpired(false);
  }, []);

  const auth = useMemo(
    () => ({ status, expired, onLoggedIn, onLoggedOut }),
    [status, expired, onLoggedIn, onLoggedOut],
  );

  const extensions = useMemo(() => {
    if (status === "cloud") {
      return {
        cloudSave,
        cloudLoad,
        cloudList,
        cloudDelete,
        cloudCurrentUserId: "me",
        "canvas-overlay": <CloudOverlay />,
      };
    }
    if (status === "anon") {
      return { "canvas-overlay": <CloudOverlay /> };
    }
    return {};
  }, [status]);

  // Hold rendering until the auth status is known: mounting the editor first
  // and flipping extensions afterwards re-runs Workspace's load(), reverting
  // in-progress edits and clearing undo history.
  if (status === "loading") return null;

  return (
    <CloudAuthContext.Provider value={auth}>
      <ExtensionsContext.Provider value={extensions}>
        {children}
      </ExtensionsContext.Provider>
    </CloudAuthContext.Provider>
  );
}
