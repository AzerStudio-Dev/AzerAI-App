import { useEffect, useState } from "react";
import iconUrl from "/icon.png";
import "./StartupGate.css";
import { useLanguage } from "../LanguageContext";

const MIN_LOADING_MS = 1600;

export default function StartupGate({ children }) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState("loading");
  const [updateInfo, setUpdateInfo] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [downloadPhase, setDownloadPhase] = useState("idle");
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadError, setDownloadError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const minDelay = new Promise((resolve) => {
        setTimeout(resolve, MIN_LOADING_MS);
      });

      try {
        if (!window.livekit?.checkAppUpdate) {
          await minDelay;
          if (!cancelled) {
            await window.livekit?.startBackend?.();
            setPhase("ready");
          }
          return;
        }

        const [, updateResult] = await Promise.all([
          minDelay,
          window.livekit.checkAppUpdate(),
        ]);

        if (cancelled) return;

        if (updateResult?.updateAvailable) {
          setUpdateInfo(updateResult);
          setPhase("update");
          return;
        }

        await window.livekit.startBackend();
        if (!cancelled) {
          setPhase("ready");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Startup check failed:", error);
          setBootError(error?.message || String(error));
          try {
            await window.livekit?.startBackend?.();
            setPhase("ready");
          } catch (backendError) {
            console.error("Backend start failed:", backendError);
            setPhase("error");
          }
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.livekit?.onUpdateDownloadProgress) {
      return undefined;
    }

    const unsubscribe = window.livekit.onUpdateDownloadProgress((progress) => {
      setDownloadPercent(progress?.percent ?? 0);
    });

    return unsubscribe;
  }, []);

  async function handleUpdate() {
    if (!updateInfo?.downloadUrl || !window.livekit?.downloadAppUpdate) {
      if (updateInfo?.releaseUrl) {
        window.open(updateInfo.releaseUrl, "_blank");
      }
      return;
    }

    setDownloadError(null);
    setDownloadPhase("downloading");
    setDownloadPercent(0);

    try {
      const result = await window.livekit.downloadAppUpdate();
      if (!result?.success) {
        throw new Error(result?.error || "Yeniləmə uğursuz oldu");
      }
      setDownloadPhase("installing");
    } catch (error) {
      setDownloadPhase("idle");
      setDownloadError(error?.message || String(error));
    }
  }

  if (phase === "ready") {
    return children;
  }

  if (phase === "update") {
    return (
      <div className="startup-screen">
        <div className="startup-card startup-card--update">
          <div className="startup-brand">
            <div className="startup-brand__mark">
              <img src={iconUrl} alt="AzerAI" />
            </div>
            <div>
              <p className="startup-kicker">{t("updateAvailable")}</p>
              <h1>AzerAI App</h1>
            </div>
          </div>

          <div className="startup-update-meta">
            <div className="startup-version-pill">
              <span>{t("currentVersion")}</span>
              <strong>v{updateInfo?.currentVersion}</strong>
            </div>
            <div className="startup-version-arrow">→</div>
            <div className="startup-version-pill startup-version-pill--new">
              <span>{t("newVersion")}</span>
              <strong>v{updateInfo?.latestVersion}</strong>
            </div>
          </div>

          <p className="startup-copy">
            {t("updateDesc")}
          </p>

          {updateInfo?.releaseNotes ? (
            <div className="startup-release-notes">
              <p className="startup-release-notes__title">{t("changes")}</p>
              <pre>{updateInfo.releaseNotes.trim()}</pre>
            </div>
          ) : null}

          {downloadPhase === "downloading" ? (
            <div className="startup-progress">
              <div className="startup-progress__bar">
                <span style={{ width: `${downloadPercent}%` }} />
              </div>
              <p>{t("downloadingPercent", downloadPercent)}</p>
            </div>
          ) : null}

          {downloadPhase === "installing" ? (
            <p className="startup-status-msg">{t("installerOpening")}</p>
          ) : null}

          {downloadError ? (
            <div className="startup-error-box">{downloadError}</div>
          ) : null}

          <div className="startup-actions">
            <button
              className="startup-primary-btn"
              type="button"
              onClick={handleUpdate}
              disabled={
                downloadPhase === "downloading" || downloadPhase === "installing"
              }
            >
              {downloadPhase === "downloading"
                ? `${t("loading")} (${downloadPercent}%)`
                : downloadPhase === "installing"
                  ? t("installerOpening")
                  : updateInfo?.downloadUrl
                    ? t("update")
                    : t("openReleasePage")}
            </button>

            {updateInfo?.releaseUrl ? (
              <button
                className="startup-secondary-btn"
                type="button"
                onClick={() => window.open(updateInfo.releaseUrl, "_blank")}
                disabled={downloadPhase !== "idle"}
              >
                {t("viewOnGithub")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="startup-screen">
        <div className="startup-card">
          <div className="startup-brand">
            <div className="startup-brand__mark">
              <img src={iconUrl} alt="AzerAI" />
            </div>
            <div>
              <p className="startup-kicker">{t("startupError")}</p>
              <h1>AzerAI App</h1>
            </div>
          </div>
          <div className="startup-error-box">{bootError}</div>
          <button
            className="startup-primary-btn"
            type="button"
            onClick={() => window.location.reload()}
          >
            {t("tryAgain")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="startup-screen">
      <div className="startup-card startup-card--loading">
        <div className="startup-brand startup-brand--center">
          <div className="startup-brand__mark startup-brand__mark--pulse">
            <img src={iconUrl} alt="AzerAI" />
          </div>
          <div>
            <p className="startup-kicker">{t("startupLoading")}</p>
            <h1>AzerAI App</h1>
          </div>
        </div>

        <div className="startup-loader" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <p className="startup-copy startup-copy--center">
          {t("startupLoadingDesc")}
        </p>
      </div>
    </div>
  );
}
