import {
  LiveKitRoom,
  RoomAudioRenderer,
  ControlBar,
  VideoConference,
  useLocalParticipant,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { useState, useEffect } from "react";
import { DisconnectReason } from "livekit-client";
import ConversationPanel from "./components/ConversationPanel";
import "./App.css";
import iconUrl from "/icon.png";
import { useLanguage } from "./LanguageContext";

async function signJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  
  const base64UrlEncode = (str) => {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };

  const headerStr = base64UrlEncode(JSON.stringify(header));
  const payloadStr = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = new TextEncoder().encode(headerStr + "." + payloadStr);
  
  const keyBytes = new TextEncoder().encode(secret);
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  
  const signature = await window.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    dataToSign
  );
  
  const signatureBytes = new Uint8Array(signature);
  let signatureBinary = '';
  for (let i = 0; i < signatureBytes.byteLength; i++) {
    signatureBinary += String.fromCharCode(signatureBytes[i]);
  }
  const signatureStr = btoa(signatureBinary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return headerStr + "." + payloadStr + "." + signatureStr;
}

const getWebConnectionDetails = async (customSettings) => {
  const apiKey = customSettings.LIVEKIT_API_KEY;
  const apiSecret = customSettings.LIVEKIT_API_SECRET;
  const livekitUrl = customSettings.LIVEKIT_URL;

  if (!livekitUrl) throw new Error("LIVEKIT_URL çatışmır");
  if (!apiKey) throw new Error("LIVEKIT_API_KEY çatışmır");
  if (!apiSecret) throw new Error("LIVEKIT_API_SECRET çatışmır");

  const agentName = customSettings.LIVEKIT_AGENT_NAME;
  const participantName = "user";
  const participantIdentity = `user_${Math.floor(Math.random() * 10000)}`;
  const roomName = `room_${Math.floor(Math.random() * 10000)}`;

  const nbf = Math.floor(Date.now() / 1000) - 30; // 30s buffer
  const exp = nbf + 15 * 60; // 15 mins TTL

  const payload = {
    iss: apiKey,
    sub: participantIdentity,
    name: participantName,
    nbf,
    exp,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    },
  };

  if (agentName) {
    payload.roomConfig = {
      agents: [{ agentName }],
    };
  }

  const participantToken = await signJWT(payload, apiSecret);

  return {
    serverUrl: livekitUrl,
    roomName,
    participantName,
    participantToken,
  };
};

function LiveKitStateSync({ updateOverlayState }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();

  // Send current microphone state to main/overlay when it changes
  useEffect(() => {
    if (updateOverlayState) {
      updateOverlayState({ microphoneEnabled: isMicrophoneEnabled });
    }
  }, [isMicrophoneEnabled]);

  // Send current camera state to main/overlay when it changes
  useEffect(() => {
    if (updateOverlayState) {
      updateOverlayState({ cameraEnabled: isCameraEnabled });
    }
  }, [isCameraEnabled]);

  // Send current screen share state to main/overlay when it changes
  useEffect(() => {
    if (updateOverlayState) {
      updateOverlayState({ screenShareEnabled: isScreenShareEnabled });
    }
  }, [isScreenShareEnabled]);

  // Listen for mic toggle requests from the main process / overlay
  useEffect(() => {
    if (!window.livekit?.onToggleMicrophone) return;

    const unsubscribe = window.livekit.onToggleMicrophone(() => {
      if (localParticipant) {
        localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
      }
    });
    return unsubscribe;
  }, [localParticipant, isMicrophoneEnabled]);

  // Listen for camera toggle requests from the main process / overlay
  useEffect(() => {
    if (!window.livekit?.onToggleCamera) return;

    const unsubscribe = window.livekit.onToggleCamera(() => {
      if (localParticipant) {
        localParticipant.setCameraEnabled(!isCameraEnabled);
      }
    });
    return unsubscribe;
  }, [localParticipant, isCameraEnabled]);

  // Listen for screen share toggle requests from the main process / overlay
  useEffect(() => {
    if (!window.livekit?.onToggleScreenShare) return;

    const unsubscribe = window.livekit.onToggleScreenShare(() => {
      if (localParticipant) {
        localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
      }
    });
    return unsubscribe;
  }, [localParticipant, isScreenShareEnabled]);

  return null;
}



function ConversationPanelPlaceholder({ isReconnecting, isOffline }) {
  const { t } = useLanguage();
  return (
    <aside className="conversation-panel" style={{ opacity: 0.65, pointerEvents: "none" }}>
      <header className="conversation-header">
        <div>
          <p className="conversation-kicker">{t("textStream")}</p>
          <h2>{t("conversation")}</h2>
        </div>
        <span className="agent-status">
          {t("agentStatusPrefix")} {isReconnecting ? (isOffline ? t("waitingForInternet") : t("reconnecting")) : t("offline")}
        </span>
      </header>

      <ul className="conversation-messages">
        <li className="conversation-empty" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
          {isReconnecting 
            ? t("reconnectEmptyPlaceholder")
            : t("sessionHistoryPlaceholder")
          }
        </li>
      </ul>

      <form className="conversation-composer" onSubmit={(e) => e.preventDefault()}>
        <label className="conversation-composer__label" htmlFor="chat-draft-disabled">
          {t("typeMessage")}
        </label>
        <div className="conversation-composer__row">
          <textarea
            id="chat-draft-disabled"
            className="conversation-composer__input"
            placeholder={isReconnecting ? t("reconnectEmptyPlaceholderTextarea") : t("chatEmptyPlaceholderTextarea")}
            rows={2}
            disabled
          />
          <button
            className="conversation-composer__send"
            type="button"
            disabled
          >
            {t("send")}
          </button>
        </div>
      </form>
    </aside>
  );
}

export default function App() {
  const { language, changeLanguage, t } = useLanguage();
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [shouldBeConnected, setShouldBeConnected] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [settingsForm, setSettingsForm] = useState({});
  const [settingsSaveStatus, setSettingsSaveStatus] = useState(null);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverStatus, setServerStatus] = useState("stopped");
  const [serverExeExists, setServerExeExists] = useState(true);
  const [serverVersion, setServerVersion] = useState(null);
  const [hasServerUpdate, setHasServerUpdate] = useState(false);
  const [serverUpdateInfo, setServerUpdateInfo] = useState(null);
  const [serverUpdateChecked, setServerUpdateChecked] = useState(false);
  const [isInstallingServer, setIsInstallingServer] = useState(false);
  const [serverInstallSuccess, setServerInstallSuccess] = useState(false);
  const [isUpgradingServer, setIsUpgradingServer] = useState(false);
  const [serverUpgradeSuccess, setServerUpgradeSuccess] = useState(false);
  const [isUninstallingServer, setIsUninstallingServer] = useState(false);
  const [serverUninstallSuccess, setServerUninstallSuccess] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentStatus, setAgentStatus] = useState("stopped");
  const [agentExeExists, setAgentExeExists] = useState(true);
  const [isInstallingAgent, setIsInstallingAgent] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);
  const [hasAgentUpdate, setHasAgentUpdate] = useState(false);
  const [agentUpdatePackages, setAgentUpdatePackages] = useState([]);
  const [isUpgradingAgent, setIsUpgradingAgent] = useState(false);
  const [upgradeSuccess, setUpgradeSuccess] = useState(false);
  const [isUninstallingAgent, setIsUninstallingAgent] = useState(false);
  const [uninstallSuccess, setUninstallSuccess] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [clearHistorySuccess, setClearHistorySuccess] = useState(false);
  const [hasHistoryFile, setHasHistoryFile] = useState(false);
  const [aiProvider, setAiProvider] = useState("google");
  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const [autoConnectEnabled, setAutoConnectEnabled] = useState(false); // Auto-connect on startup
  const [agentLaunchMode, setAgentLaunchMode] = useState("start"); // "start" (fast) or "dev" (slow)

  // Plugin management state
  const [plugins, setPlugins] = useState({ pip: [], local: [] });
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pipPluginInput, setPipPluginInput] = useState("");
  const [isInstallingPipPlugin, setIsInstallingPipPlugin] = useState(false);
  const [isInstallingLocalPlugin, setIsInstallingLocalPlugin] = useState(false);
  const [pipInstallMsg, setPipInstallMsg] = useState(null);
  const [localInstallMsg, setLocalInstallMsg] = useState(null);

  // Check overlay enabled state from backend
  const checkOverlayEnabled = async () => {
    if (window.livekit?.azeraiIsEnabled) {
      try {
        const enabled = await window.livekit.azeraiIsEnabled();
        setOverlayEnabled(enabled);
      } catch {}
    }
  };

  // Toggle overlay on/off and persist
  const handleOverlayToggle = async () => {
    const newEnabled = !overlayEnabled;
    setOverlayEnabled(newEnabled);
    if (window.livekit?.azeraiSetEnabled) {
      await window.livekit.azeraiSetEnabled(newEnabled);
    }
  };

  // Toggle auto-connect on/off and persist immediately
  const handleAutoConnectToggle = async () => {
    const newEnabled = !autoConnectEnabled;
    setAutoConnectEnabled(newEnabled);
    
    // Save to settings immediately
    try {
      await storeSettings({
        ...settings,
        AUTO_CONNECT_ENABLED: newEnabled,
      });
    } catch (err) {
      console.error("Failed to save auto-connect setting:", err);
    }
  };

  // Toggle agent launch mode and persist immediately
  const handleAgentLaunchModeToggle = async () => {
    const newMode = agentLaunchMode === "start" ? "dev" : "start";
    setAgentLaunchMode(newMode);
    
    // Save to settings immediately
    try {
      await storeSettings({
        ...settings,
        AGENT_LAUNCH_MODE: newMode,
      });
    } catch (err) {
      console.error("Failed to save agent launch mode:", err);
    }
  };

  const checkServerStatus = async () => {
    if (window.livekit?.serverStatus) {
      try {
        const status = await window.livekit.serverStatus();
        setServerRunning(status.running);
        setServerStatus(status.status || (status.running ? "active" : "stopped"));
        setServerExeExists(status.exeExists !== false);
        setServerVersion(status.version || null);
      } catch {}
    } else {
      setServerRunning(settingsForm.LIVEKIT_SERVER_ENABLED !== false);
      setServerStatus("active");
      setServerExeExists(true);
    }
  };

  const checkAgentStatus = async () => {
    if (window.livekit?.agentStatus) {
      try {
        const status = await window.livekit.agentStatus();
        setAgentRunning(status.running);
        setAgentStatus(status.status || (status.running ? "active" : "stopped"));
        setAgentExeExists(status.exeExists);
      } catch (err) {
        console.error("Agent status check error:", err);
      }
    } else {
      setAgentRunning(settingsForm.AGENT_ENABLED !== false);
      setAgentStatus("active");
      setAgentExeExists(true);
    }
  };

  const handleServerToggle = async () => {
    if (serverRunning) {
      setServerStatus("stopping");
      if (window.livekit?.serverStop) {
        await window.livekit.serverStop();
      }
    } else {
      setServerStatus("starting");
      if (window.livekit?.serverStart) {
        await window.livekit.serverStart();
      }
    }
    setTimeout(checkServerStatus, 1000);

    // Refresh settings form to reflect backend changes (local defaults or restored values)
    try {
      const updatedSettings = await fetchSettings();
      setSettings(updatedSettings);
      setSettingsForm(updatedSettings);
    } catch (err) {
      console.error("Settings refresh after server toggle failed:", err);
    }
  };

  const checkServerUpdate = async () => {
    if (!window.livekit?.serverCheckUpdate || isUpgradingServer || serverUpdateChecked) return;
    try {
      const result = await window.livekit.serverCheckUpdate();
      setServerUpdateInfo(result || null);
      setHasServerUpdate(!!result?.hasUpdate);
      if (result?.hasUpdate) {
        setServerUpdateChecked(true);
      }
    } catch (err) {
      console.error("LiveKit server update check error:", err);
    }
  };

  const handleServerInstall = async () => {
    if (isInstallingServer) return;
    setIsInstallingServer(true);
    setServerInstallSuccess(false);
    const res = await window.livekit?.serverInstall();
    if (res?.success) {
      setServerInstallSuccess(true);
      setServerUpdateChecked(false);
      setHasServerUpdate(false);
      setServerUpdateInfo(null);
      setTimeout(() => setServerInstallSuccess(false), 5000);
      checkServerStatus();
    } else {
      alert((language === "az" ? "Xəta: " : language === "tr" ? "Hata: " : "Error: ") + (res?.error || ""));
    }
    setIsInstallingServer(false);
  };

  const handleServerUpgrade = async () => {
    if (isUpgradingServer) return;
    setIsUpgradingServer(true);
    setServerUpgradeSuccess(false);
    const res = await window.livekit?.serverUpgrade();
    if (res?.success) {
      setServerUpgradeSuccess(true);
      setHasServerUpdate(false);
      setServerUpdateInfo(null);
      setServerUpdateChecked(false);
      setTimeout(() => setServerUpgradeSuccess(false), 5000);
      checkServerStatus();
    } else {
      alert((language === "az" ? "Yenilənmə xətası: " : language === "tr" ? "Güncelleme hatası: " : "Update error: ") + (res?.error || ""));
    }
    setIsUpgradingServer(false);
  };

  const handleServerUninstall = async () => {
    if (isUninstallingServer || serverRunning) return;
    if (!confirm(t("uninstallLiveKitConfirm"))) return;
    setIsUninstallingServer(true);
    setServerUninstallSuccess(false);
    const res = await window.livekit?.serverUninstall();
    if (res?.success) {
      setServerUninstallSuccess(true);
      setServerExeExists(false);
      setServerVersion(null);
      setHasServerUpdate(false);
      setServerUpdateInfo(null);
      setServerUpdateChecked(false);
      setTimeout(() => setServerUninstallSuccess(false), 5000);
      checkServerStatus();
    } else {
      alert((language === "az" ? "Silinmə xətası: " : language === "tr" ? "Silme hatası: " : "Uninstall error: ") + (res?.error || ""));
    }
    setIsUninstallingServer(false);
  };

  const handleAgentToggle = async () => {
    if (agentRunning) {
      setAgentStatus("stopping");
      if (window.livekit?.agentStop) {
        await window.livekit.agentStop();
      }
    } else {
      if (!agentExeExists) return;
      setAgentStatus("starting");
      if (window.livekit?.agentStart) {
        await window.livekit.agentStart();
      }
    }
    setTimeout(checkAgentStatus, 2000);
  };

  const handleAgentInstall = async () => {
    if (isInstallingAgent) return;
    setIsInstallingAgent(true);
    setInstallSuccess(false);
    
    if (window.livekit?.agentInstall) {
      const res = await window.livekit.agentInstall();
      if (res.success) {
        setInstallSuccess(true);
        setTimeout(() => {
          setInstallSuccess(false);
        }, 5000);
        checkAgentStatus();
        listPlugins();
      } else {
        alert((language === "az" ? "Xəta: " : language === "tr" ? "Hata: " : "Error: ") + res.error);
      }
    }
    setIsInstallingAgent(false);
  };

  const handleAgentUpgrade = async () => {
    if (isUpgradingAgent) return;
    setIsUpgradingAgent(true);
    setUpgradeSuccess(false);
    
    if (window.livekit?.agentUpgrade) {
      const packageNames = agentUpdatePackages.map(p => p.name);
      const res = await window.livekit.agentUpgrade(packageNames);
      if (res.success) {
        setUpgradeSuccess(true);
        setHasAgentUpdate(false);
        setAgentUpdatePackages([]);
        setTimeout(() => {
          setUpgradeSuccess(false);
        }, 5000);
        checkAgentStatus();
        listPlugins();
      } else {
        alert((language === "az" ? "Yenilənmə xətası: " : language === "tr" ? "Güncelleme hatası: " : "Update error: ") + res.error);
      }
    }
    setIsUpgradingAgent(false);
  };

  const handleAgentUninstall = async () => {
    if (isUninstallingAgent) return;
    if (!confirm(t("uninstallAgentConfirm"))) return;
    
    setIsUninstallingAgent(true);
    setUninstallSuccess(false);
    
    if (window.livekit?.agentUninstall) {
      const res = await window.livekit.agentUninstall();
      if (res.success) {
        setUninstallSuccess(true);
        setTimeout(() => {
          setUninstallSuccess(false);
        }, 5000);
        checkAgentStatus();
      } else {
        alert((language === "az" ? "Silinmə xətası: " : language === "tr" ? "Silme hatası: " : "Uninstall error: ") + res.error);
      }
    }
    setIsUninstallingAgent(false);
  };

  const handleClearHistory = async () => {
    if (isClearingHistory || agentRunning) return;
    if (!confirm(t("clearHistoryConfirm"))) return;

    setIsClearingHistory(true);
    setClearHistorySuccess(false);

    if (window.livekit?.agentClearHistory) {
      const res = await window.livekit.agentClearHistory();
      if (res.success) {
        setClearHistorySuccess(true);
        setHasHistoryFile(false); // Silindikdən sonra dərhal deaktif et
        setTimeout(() => {
          setClearHistorySuccess(false);
        }, 5000);
      } else {
        alert((language === "az" ? "Xəta: " : language === "tr" ? "Hata: " : "Error: ") + res.error);
      }
    }
    setIsClearingHistory(false);
  };

  // ── Plugin management handlers ────────────────────────────────────
  const listPlugins = async () => {
    if (!window.livekit?.pluginList) return;
    setPluginsLoading(true);
    try {
      const result = await window.livekit.pluginList();
      setPlugins(result);
    } catch (e) {
      console.error("Plugin list error:", e);
    }
    setPluginsLoading(false);
  };

  const handleInstallPipPlugin = async () => {
    if (isInstallingPipPlugin || !pipPluginInput.trim()) return;
    setIsInstallingPipPlugin(true);
    setPipInstallMsg(null);
    const res = await window.livekit?.pluginInstallPip(pipPluginInput.trim());
    if (res?.success) {
      setPipInstallMsg({ type: "success", text: `✓ "${pipPluginInput.trim()}" ${t("pipInstallSuccess")}` });
      setPipPluginInput("");
      listPlugins();
    } else {
      setPipInstallMsg({ type: "error", text: (language === "az" ? "Xəta: " : language === "tr" ? "Hata: " : "Error: ") + (res?.error || (language === "az" ? "Bilinməyən xəta" : language === "tr" ? "Bilinmeyen hata" : "Unknown error")) });
    }
    setTimeout(() => setPipInstallMsg(null), 6000);
    setIsInstallingPipPlugin(false);
  };

  const handleUninstallPipPlugin = async (name) => {
    if (!confirm(`"${name}" ${t("uninstallConfirm")}`)) return;
    const res = await window.livekit?.pluginUninstallPip(name);
    if (res?.success) {
      setPipInstallMsg({ type: "success", text: `✓ "${name}" ${t("pipUninstallSuccess")}` });
      listPlugins();
    } else {
      setPipInstallMsg({ type: "error", text: (language === "az" ? "Xəta: " : language === "tr" ? "Hata: " : "Error: ") + (res?.error || "") });
    }
    setTimeout(() => setPipInstallMsg(null), 6000);
  };

  const handleInstallLocalPlugin = async () => {
    if (isInstallingLocalPlugin) return;
    setIsInstallingLocalPlugin(true);
    setLocalInstallMsg(null);
    const res = await window.livekit?.pluginInstallLocal();
    if (res?.success) {
      setLocalInstallMsg({ type: "success", text: t("localPluginSuccess") });
      listPlugins();
    } else if (!res?.canceled) {
      setLocalInstallMsg({ type: "error", text: (language === "az" ? "Xəta: " : language === "tr" ? "Hata: " : "Error: ") + (res?.error || (language === "az" ? "Bilinməyən xəta" : language === "tr" ? "Bilinmeyen hata" : "Unknown error")) });
    }
    setTimeout(() => setLocalInstallMsg(null), 6000);
    setIsInstallingLocalPlugin(false);
  };

  const handleUninstallLocalPlugin = async (name) => {
    if (!confirm(`"${name}" ${t("uninstallLocalConfirm")}`)) return;
    const res = await window.livekit?.pluginUninstallLocal(name);
    if (res?.success) {
      setLocalInstallMsg({ type: "success", text: `✓ "${name}" ${t("localUninstallSuccess")}` });
      listPlugins();
    } else {
      setLocalInstallMsg({ type: "error", text: (language === "az" ? "Xəta: " : language === "tr" ? "Hata: " : "Error: ") + (res?.error || "") });
    }
    setTimeout(() => setLocalInstallMsg(null), 6000);
  };

  const fetchSettings = async () => {
    if (window.livekit?.getSettings) {
      try {
        return await window.livekit.getSettings();
      } catch (err) {
        console.error("Electron getSettings failed, using web storage", err);
      }
    }
    const saved = localStorage.getItem("livekit_settings");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return {
      LIVEKIT_URL: "",
      LIVEKIT_API_KEY: "",
      LIVEKIT_API_SECRET: "",
      LIVEKIT_AGENT_NAME: "",
      AI_PROVIDER: "google",
    };
  };

  const storeSettings = async (newSettings) => {
    if (window.livekit?.saveSettings) {
      try {
        return await window.livekit.saveSettings(newSettings);
      } catch (err) {
        console.error("Electron saveSettings failed, using web storage", err);
      }
    }
    localStorage.setItem("livekit_settings", JSON.stringify(newSettings));
    return { success: true };
  };

  useEffect(() => {
    fetchSettings().then((savedSettings) => {
      setSettings(savedSettings);
      setSettingsForm(savedSettings);
      setAiProvider(savedSettings.AI_PROVIDER || "google");
      setOverlayEnabled(savedSettings.OVERLAY_ENABLED !== false);
      setAutoConnectEnabled(savedSettings.AUTO_CONNECT_ENABLED || false);
      setAgentLaunchMode(savedSettings.AGENT_LAUNCH_MODE || "start");
    });
  }, []);

  // Auto-connect on startup if enabled
  useEffect(() => {
    if (autoConnectEnabled && !connection && !isConnecting) {
      // Wait a bit for services to start, then connect
      const timer = setTimeout(() => {
        handleConnect();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [autoConnectEnabled]);

  // Statuslari avtomatik yenile
  useEffect(() => {
    checkServerStatus();
    checkAgentStatus();
    const interval = setInterval(() => {
      checkServerStatus();
      checkAgentStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenSettings = () => {
    setIsSettingsOpen(true);
    setSettingsSaveStatus(null);
    checkServerStatus();
    checkAgentStatus();
    checkOverlayEnabled();
    checkServerUpdate();
    
    // Ayarlar açılan zaman yeniləməni yoxla (yalnız exe varsa və hazırda yenilənmə getmirsə)
    if (agentExeExists && window.livekit?.agentCheckUpdate && !isUpgradingAgent) {
      window.livekit.agentCheckUpdate().then(result => {
        if (result && typeof result === "object") {
          setHasAgentUpdate(result.hasUpdate);
          setAgentUpdatePackages(result.packages || []);
        } else {
          setHasAgentUpdate(!!result);
          setAgentUpdatePackages([]);
        }
      });
    }

    // Tarixçə faylının olub-olmadığını yoxla
    if (window.livekit?.agentCheckHistory) {
      window.livekit.agentCheckHistory().then(exists => {
        setHasHistoryFile(exists);
      });
    }

    // Plugin siyahısını yüklə
    listPlugins();

    fetchSettings().then((savedSettings) => {
      setSettings(savedSettings);
      setSettingsForm(savedSettings);
      setAiProvider(savedSettings.AI_PROVIDER || "google");
    });
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      if (shouldBeConnected && !connection && !isConnecting) {
        handleConnect();
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
      setConnection(null); // Force full clean disconnect of LiveKitRoom
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [shouldBeConnected, connection, isConnecting]);

  // Mini AzerAI overlay state update
  const updateOverlayState = (state) => {
    if (window.livekit?.azeraiUpdateState) {
      window.livekit.azeraiUpdateState(state).catch(err => {
        console.warn("Overlay update failed:", err);
      });
    }
  };

  // Caption overlay send
  const sendCaption = (data) => {
    if (window.livekit?.captionSend) {
      window.livekit.captionSend(data).catch(err => {
        console.warn("Caption send failed:", err);
      });
    }
  };

  const handleConnect = () => {
    setShouldBeConnected(true);
    setIsConnecting(true);
    setError(null);

    if (window.livekit?.getConnectionDetails) {
      window.livekit
        .getConnectionDetails()
        .then((details) => {
          setConnection(details);
          setIsConnecting(false);
        })
        .catch((err) => {
          console.error("Connection attempt failed:", err);
          setIsConnecting(false);
        });
    } else {
      getWebConnectionDetails(settings)
        .then((details) => {
          setConnection(details);
          setIsConnecting(false);
        })
        .catch((err) => {
          console.error("Web connection generation failed:", err);
          setError(err.message || String(err));
          setIsConnecting(false);
        });
    }
  };

  const handleCancelReconnect = () => {
    setShouldBeConnected(false);
    setIsConnecting(false);
    setConnection(null);
    setError(null);
  };

  const handleDisconnect = (reason) => {
    console.log("Disconnected reason:", reason);
    
    // Update overlay state to disconnected
    updateOverlayState({ connected: false });
    
    if (reason === DisconnectReason.CLIENT_INITIATED) {
      setShouldBeConnected(false);
      setConnection(null);
    } else {
      // Connection dropped or kicked by server, reset local connection details but keep trying in background
      setConnection(null);
    }
  };

  // Mirror connected state to Mini AzerAI overlay (shows connected/disconnected status)
  useEffect(() => {
    const connected = !!connection && !isConnecting;
    updateOverlayState({ connected });
    // Also ensure overlay window is visible when enabled
    if (overlayEnabled && window.livekit?.azeraiShow) {
      window.livekit.azeraiShow();
    }
  }, [connection, isConnecting, overlayEnabled]);

  // Mirror language selection to Mini AzerAI overlay
  useEffect(() => {
    updateOverlayState({ language });
  }, [language]);

  // Auto retry loop if we are disconnected but should be connected
  useEffect(() => {
    if (!shouldBeConnected || connection || isConnecting || isOffline) {
      return;
    }

    const timer = setTimeout(() => {
      console.log("Attempting background reconnect...");
      handleConnect();
    }, 5000);

    return () => clearTimeout(timer);
  }, [shouldBeConnected, connection, isConnecting, isOffline]);

  // Status text funksiyasi
  const getServerStatusText = () => {
    switch (serverStatus) {
      case "starting": return t("serverStatusTextStarting");
      case "active": return t("serverStatusTextActive");
      case "stopping": return t("serverStatusTextStopping");
      default: return t("serverStatusTextStopped");
    }
  };

  const getAgentStatusText = () => {
    switch (agentStatus) {
      case "starting": return t("agentStatusTextStarting");
      case "active": return t("agentStatusTextActive");
      case "stopping": return t("agentStatusTextStopping");
      default: return t("agentStatusTextStopped");
    }
  };

  const getServerStatusDot = () => {
    if (serverStatus === "active") return "on";
    if (serverStatus === "starting" || serverStatus === "stopping") return "pending";
    return "off";
  };

  const getAgentStatusDot = () => {
    if (agentStatus === "active") return "on";
    if (agentStatus === "starting" || agentStatus === "stopping") return "pending";
    return "off";
  };

  if (error) {
    return (
      <div className="screen shell shell--empty">
        <main className="empty-state">
          <div className="empty-state__eyebrow">AzerAI Masaüstü</div>
          <h1>{t("connectionFailed")}</h1>
          <p className="empty-state__copy">
            {t("connectionFailedDesc")}
          </p>
          <div className="empty-state__error">
            <span>{language === "az" ? "Xəta" : language === "tr" ? "Hata" : "Error"}</span>
            <strong>{error}</strong>
          </div>
          <div className="empty-state__actions">
            <button
              className="primary-action"
              type="button"
              onClick={() => window.location.reload()}
            >
              {t("tryAgain")}
            </button>
            <button
              className="settings-trigger-button"
              type="button"
              onClick={handleOpenSettings}
            >
              ⚙️ {t("settings")}
            </button>
            <p className="hint">
              {language === "az" 
                ? "`LIVEKIT_URL`, `LIVEKIT_API_KEY` və `LIVEKIT_API_SECRET` dəyərlərini yoxlayın və ya Parametrlər panelindən düzəldin."
                : language === "tr"
                ? "`LIVEKIT_URL`, `LIVEKIT_API_KEY` ve `LIVEKIT_API_SECRET` değerlerini kontrol edin veya Ayarlar panelinden düzeltin."
                : "Verify the `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` values, or fix them in the Settings panel."}
            </p>
          </div>
        </main>
        {renderSettingsModal()}
      </div>
    );
  }

  const isConnected = !!connection && !isConnecting;
  const isReconnecting = shouldBeConnected && !connection;

  const renderContent = () => (
    <div className="screen shell">
      <header className="app-topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><img src={iconUrl} alt="AzerAI" /></div>
          <div>
            <p className="brand-kicker">{t("voiceAssistant")}</p>
            <h1>AzerAI App</h1>
          </div>
        </div>

        <div className="topbar-right">
          <div className="session-summary">
            {isConnected ? (
              <>
                <div className="summary-item">
                  <span>{t("room")}</span>
                  <strong>{connection.roomName}</strong>
                </div>
                <div className="summary-item">
                  <span>{t("user")}</span>
                  <strong>{connection.participantName}</strong>
                </div>
              </>
            ) : (
              <div className="summary-item" style={{ borderColor: isReconnecting ? "rgba(245, 158, 11, 0.25)" : "rgba(239, 68, 68, 0.25)" }}>
                <span>{t("status")}</span>
                <strong style={{ color: isReconnecting ? "#fbbf24" : "#f87171" }}>
                  {isReconnecting ? (isOffline ? t("waitingForInternet") : t("reconnecting")) : t("noSessionConnection")}
                </strong>
              </div>
            )}
          </div>

          <button
            className="settings-trigger-button"
            onClick={handleOpenSettings}
            type="button"
            title={t("settings")}
          >
            ⚙️ {t("settings")}
          </button>
        </div>
      </header>

      <div className="app-layout">
        <section className="video-area">
          <div className="video-stage">
            <div className="stage-overlay">
              <div>
                <p className="stage-label">{t("mainStage")}</p>
                <h2>{t("conversationStream")}</h2>
              </div>
              {isConnected ? (
                <span className="stage-badge">{t("live")}</span>
              ) : (
                <span
                  className="stage-badge"
                  style={{
                    background: isReconnecting ? "rgba(245, 158, 11, 0.15)" : "rgba(255, 255, 255, 0.05)",
                    borderColor: isReconnecting ? "rgba(245, 158, 11, 0.3)" : "rgba(255, 255, 255, 0.15)",
                    color: isReconnecting ? "#fbbf24" : "rgba(255, 255, 255, 0.6)",
                  }}
                >
                  {isReconnecting ? t("connecting") : t("offline")}
                </span>
              )}
            </div>
            <div className="video-frame">
              {isConnected ? (
                <VideoConference />
              ) : isReconnecting ? (
                <div className="connect-placeholder">
                  <div className="connect-placeholder__icon" style={{ animationDuration: "1.5s" }}>🔄</div>
                  <h3>{isOffline ? t("waitingForInternet") : t("reconnecting")}</h3>
                  <p>
                    {isOffline 
                      ? t("waitingInternetDesc")
                      : t("connectionLostDesc")}
                  </p>
                  <button
                    className="primary-action"
                    style={{ background: "linear-gradient(135deg, #fca5a5, #f87171)", color: "#7f1d1d" }}
                    type="button"
                    onClick={handleCancelReconnect}
                  >
                    {t("cancel")}
                  </button>
                  <div className="loading-line" style={{ margin: "1.5rem auto 0" }} />
                </div>
              ) : (
                <div className="connect-placeholder">
                  <div className="connect-placeholder__icon">🎙️</div>
                  <h3>{t("connectPlaceholderTitle")}</h3>
                  <p>
                    {t("connectPlaceholderDesc")}
                  </p>
                  <button
                    className="primary-action"
                    type="button"
                    onClick={handleConnect}
                    disabled={isConnecting}
                  >
                    {isConnecting ? t("preparingSession") : t("joinRoom")}
                  </button>
                  {isConnecting && (
                    <div className="loading-line" style={{ margin: "1.5rem auto 0" }} />
                  )}
                </div>
              )}
            </div>
          </div>

          {isConnected && (
            <div className="controls">
              <div className="controls-dock">
                <div className="controls-caption">
                  {t("controlsDesc")}
                </div>
                <ControlBar
                  variation="minimal"
                  controls={{
                    microphone: true,
                    camera: true,
                    screenShare: true,
                    chat: false,
                    leave: true,
                    settings: false,
                  }}
                />
              </div>
            </div>
          )}
        </section>

        {isConnected ? (
          <ConversationPanel disabledByMiniAzer={overlayEnabled} />
        ) : (
          <ConversationPanelPlaceholder isReconnecting={isReconnecting} isOffline={isOffline} />
        )}
      </div>
    </div>
  );

  const renderSettingsModal = () => {
    if (!isSettingsOpen) return null;

    return (
      <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
        <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <h2>{t("appSettings")}</h2>
            <button
              className="settings-close-btn"
              onClick={() => setIsSettingsOpen(false)}
              type="button"
            >
              &times;
            </button>
          </div>
          
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setSettingsSaveStatus("saving");
              try {
                const res = await storeSettings({
                  ...settingsForm,
                  AI_PROVIDER: aiProvider,
                  OVERLAY_ENABLED: overlayEnabled,
                  AUTO_CONNECT_ENABLED: autoConnectEnabled,
                  AGENT_LAUNCH_MODE: agentLaunchMode,
                  APP_LANG: language,
                });
                if (res && res.success) {
                  setSettings({
                    ...settingsForm,
                    AI_PROVIDER: aiProvider,
                    OVERLAY_ENABLED: overlayEnabled,
                    AUTO_CONNECT_ENABLED: autoConnectEnabled,
                    AGENT_LAUNCH_MODE: agentLaunchMode,
                    APP_LANG: language,
                  });
                  setSettingsSaveStatus("success");
                  setTimeout(() => setSettingsSaveStatus(null), 3000);
                } else {
                  setSettingsSaveStatus("error");
                }
              } catch (err) {
                console.error(err);
                setSettingsSaveStatus("error");
              }
            }}
          >
            <div className="settings-group">
              <label htmlFor="setting-url">{t("livekitUrl")}</label>
              <input
                id="setting-url"
                type="text"
                value={settingsForm.LIVEKIT_URL || ""}
                placeholder="wss://..."
                disabled={serverRunning}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, LIVEKIT_URL: e.target.value })
                }
              />
              <span className="settings-hint">
                {serverRunning 
                  ? `🔒 ${language === "az" ? "Server aktiv olduğu üçün dəyişdirilə bilməz" : language === "tr" ? "Server aktif olduğu için değiştirilemez" : "Cannot be changed because the server is active"}`
                  : language === "az" ? "LiveKit bulud serveri bağlantı ünvanı (məs. wss://...)" : language === "tr" ? "LiveKit bulut sunucusu bağlantı adresi (örn. wss://...)" : "LiveKit cloud server connection address (e.g. wss://...)"}
              </span>
            </div>

            <div className="settings-group">
              <label htmlFor="setting-key">{t("apiKey")}</label>
              <input
                id="setting-key"
                type="text"
                value={settingsForm.LIVEKIT_API_KEY || ""}
                placeholder="API..."
                disabled={serverRunning}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, LIVEKIT_API_KEY: e.target.value })
                }
              />
              {serverRunning && (
                <span className="settings-hint">🔒 {language === "az" ? "Server aktiv olduğu üçün dəyişdirilə bilməz" : language === "tr" ? "Server aktif olduğu için değiştirilemez" : "Cannot be changed because the server is active"}</span>
              )}
            </div>

            <div className="settings-group">
              <label htmlFor="setting-secret">{t("apiSecret")}</label>
              <input
                id="setting-secret"
                type="password"
                value={settingsForm.LIVEKIT_API_SECRET || ""}
                placeholder="••••••••••••••••"
                disabled={serverRunning}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    LIVEKIT_API_SECRET: e.target.value,
                  })
                }
              />
              {serverRunning && (
                <span className="settings-hint">🔒 {language === "az" ? "Server aktiv olduğu üçün dəyişdirilə bilməz" : language === "tr" ? "Server aktif olduğu için değiştirilemez" : "Cannot be changed because the server is active"}</span>
              )}
            </div>

            <div className="settings-group">
              <label htmlFor="setting-agent">{t("agentNameOpt")}</label>
              <input
                id="setting-agent"
                type="text"
                value={settingsForm.LIVEKIT_AGENT_NAME || ""}
                placeholder={language === "az" ? "Agent adı" : language === "tr" ? "Agent adı" : "Agent name"}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    LIVEKIT_AGENT_NAME: e.target.value,
                  })
                }
              />
              <span className="settings-hint">
                {language === "az" ? "Qoşulunacaq varsayılan süni zəka köməkçisi (Agent) adı" : language === "tr" ? "Bağlanılacak varsayılan yapay zeka asistanı (Agent) adı" : "Default AI assistant (Agent) name to connect to"}
              </span>
            </div>

            <div className="settings-group">
              <label htmlFor="setting-google-key">{t("googleApiKey")}</label>
              <input
                id="setting-google-key"
                type="password"
                value={settingsForm.GOOGLE_API_KEY || ""}
                placeholder="••••••••••••••••"
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    GOOGLE_API_KEY: e.target.value,
                  })
                }
              />
              <span className="settings-hint">
                {language === "az" ? "Google Gemini AI üçün API açarı (agent/.env faylında saxlanılır)" : language === "tr" ? "Google Gemini AI için API anahtarı (agent/.env dosyasında saklanır)" : "API key for Google Gemini AI (saved in agent/.env file)"}
              </span>
            </div>

            <div className="settings-group">
              <label htmlFor="setting-openai-key">{t("openaiApiKey")}</label>
              <input
                id="setting-openai-key"
                type="password"
                value={settingsForm.OPENAI_API_KEY || ""}
                placeholder="••••••••••••••••"
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    OPENAI_API_KEY: e.target.value,
                  })
                }
              />
              <span className="settings-hint">
                {language === "az" ? "OpenAI GPT modelləri üçün API açarı (agent/.env faylında saxlanılır)" : language === "tr" ? "OpenAI GPT modelleri için API anahtarı (agent/.env dosyasında saklanır)" : "API key for OpenAI GPT models (saved in agent/.env file)"}
              </span>
            </div>

            <div className="settings-group">
              <label>{t("aiProvider")}</label>
              <div className="ai-provider-selector">
                <button
                  type="button"
                  className={`provider-option ${aiProvider === "google" ? "provider-option--active" : ""}`}
                  onClick={() => setAiProvider("google")}
                >
                  <span className="provider-option__icon">🔮</span>
                  <span className="provider-option__label">Google</span>
                  <span className="provider-option__desc">Gemini AI</span>
                </button>
                <button
                  type="button"
                  className={`provider-option ${aiProvider === "openai" ? "provider-option--active" : ""}`}
                  onClick={() => setAiProvider("openai")}
                >
                  <span className="provider-option__icon">🤖</span>
                  <span className="provider-option__label">OpenAI</span>
                  <span className="provider-option__desc">GPT Models</span>
                </button>
              </div>
              <span className="settings-hint">
                {language === "az" ? "Süni zəka üçün istifadə olunacaq provayder (agent/.env faylında AI_PROVIDER olaraq saxlanılır)" : language === "tr" ? "Yapay zeka için kullanılacak sağlayıcı (agent/.env dosyasında AI_PROVIDER olarak saklanır)" : "Provider to be used for AI (saved as AI_PROVIDER in agent/.env file)"}
              </span>
            </div>

            <div className="settings-group">
              <label>{t("appLanguage")}</label>
              <div className="ai-provider-selector">
                <button
                  type="button"
                  className={`provider-option ${language === "az" ? "provider-option--active" : ""}`}
                  onClick={() => changeLanguage("az")}
                >
                  <span className="provider-option__icon">🇦🇿</span>
                  <span className="provider-option__label">{t("appLanguageAz")}</span>
                  <span className="provider-option__desc">AZ</span>
                </button>
                <button
                  type="button"
                  className={`provider-option ${language === "tr" ? "provider-option--active" : ""}`}
                  onClick={() => changeLanguage("tr")}
                >
                  <span className="provider-option__icon">🇹🇷</span>
                  <span className="provider-option__label">{t("appLanguageTr")}</span>
                  <span className="provider-option__desc">TR</span>
                </button>
                <button
                  type="button"
                  className={`provider-option ${language === "en" ? "provider-option--active" : ""}`}
                  onClick={() => changeLanguage("en")}
                >
                  <span className="provider-option__icon">🇬🇧</span>
                  <span className="provider-option__label">{t("appLanguageEn")}</span>
                  <span className="provider-option__desc">EN</span>
                </button>
              </div>
              <span className="settings-hint">
                {t("appLanguageDesc")}
              </span>
            </div>

            <div className="settings-group settings-toggle-group">
              <div className="settings-toggle-row">
                <div>
                  <label>{t("launchAtStartup")}</label>
                  <span className="settings-hint">{t("launchAtStartupDesc")}</span>
                </div>
                <button
                  className={`server-toggle ${settingsForm.AUTO_LAUNCH ? "server-toggle--on" : ""}`}
                  type="button"
                  onClick={() => setSettingsForm({ ...settingsForm, AUTO_LAUNCH: !settingsForm.AUTO_LAUNCH })}
                >
                  <span className="server-toggle__knob" />
                </button>
              </div>
            </div>

            <div className="settings-group settings-toggle-group">
              <div className="settings-toggle-row">
                <div>
                  <label>{t("autoConnect")}</label>
                  <span className="settings-hint">{t("autoConnectDesc")}</span>
                </div>
                <button
                  className={`server-toggle ${autoConnectEnabled ? "server-toggle--on" : ""}`}
                  type="button"
                  onClick={handleAutoConnectToggle}
                >
                  <span className="server-toggle__knob" />
                </button>
              </div>
              <div className="server-status-indicator">
                <span className={`server-status-dot ${autoConnectEnabled ? "on" : "off"}`} />
                {autoConnectEnabled ? t("active") : t("deactive")}
              </div>
            </div>

            <div className="settings-group settings-toggle-group">
              <div className="settings-toggle-row">
                <div>
                  <label>{t("agentLaunchMode")}</label>
                  <span className="settings-hint">
                    {agentLaunchMode === "start" ? t("fastModeDesc") : t("devModeDesc")}
                  </span>
                </div>
                <button
                  className={`server-toggle ${agentLaunchMode === "dev" ? "server-toggle--on" : ""}`}
                  type="button"
                  onClick={handleAgentLaunchModeToggle}
                >
                  <span className="server-toggle__knob" />
                </button>
              </div>
              <div className="server-status-indicator">
                <span className={`server-status-dot ${agentLaunchMode === "dev" ? "on" : "off"}`} />
                {agentLaunchMode === "start" 
                  ? (language === "az" ? "🚀 Start (Sürətli)" : language === "tr" ? "🚀 Start (Hızlı)" : "🚀 Start (Fast)") 
                  : (language === "az" ? "🐢 Dev (Gəlişdirmə)" : language === "tr" ? "🐢 Dev (Geliştirici)" : "🐢 Dev (Development)")}
              </div>
            </div>

            <div className="settings-group settings-toggle-group">
              <div className="settings-toggle-row">
                <div>
                  <label>{t("miniOverlay")}</label>
                  <span className="settings-hint">{t("miniOverlayDesc")}</span>
                </div>
                <button
                  className={`server-toggle ${overlayEnabled ? "server-toggle--on" : ""}`}
                  type="button"
                  onClick={handleOverlayToggle}
                >
                  <span className="server-toggle__knob" />
                </button>
              </div>
              <div className="server-status-indicator">
                <span className={`server-status-dot ${overlayEnabled ? "on" : "off"}`} />
                {overlayEnabled ? t("overlayActive") : t("overlayDeactive")}
              </div>
            </div>

            <div className="settings-group settings-toggle-group">
              <div className="settings-toggle-row">
                <div>
                  <label>{t("livekitServer")}</label>
                  <span className="settings-hint">
                    {serverVersion ? `${t("currentVersion")}: v${serverVersion}` : t("livekitServerDesc")}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {serverExeExists && hasServerUpdate && (
                    <button
                      className={`settings-btn-primary ${isUpgradingServer ? "installing-anim" : ""}`}
                      type="button"
                      onClick={handleServerUpgrade}
                      disabled={isUpgradingServer || serverRunning}
                      style={{
                        minWidth: "100px",
                        padding: "6px 12px",
                        fontSize: "0.85rem",
                        background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                        color: "#451a03",
                        opacity: serverRunning ? 0.5 : 1,
                        cursor: serverRunning ? "not-allowed" : "pointer"
                      }}
                      title={serverRunning ? t("updateLiveKitDisabled") : ""}
                    >
                      {isUpgradingServer ? t("loading") : t("update")}
                    </button>
                  )}

                  {!serverExeExists ? (
                    <button
                      className={`settings-btn-primary ${isInstallingServer ? "installing-anim" : ""}`}
                      type="button"
                      onClick={handleServerInstall}
                      disabled={isInstallingServer}
                      style={{ minWidth: "80px", padding: "8px 16px" }}
                    >
                      {isInstallingServer ? t("loading") : t("install")}
                    </button>
                  ) : (
                    <>
                      <button
                        className={`settings-btn-primary ${isUninstallingServer ? "installing-anim" : ""}`}
                        type="button"
                        onClick={handleServerUninstall}
                        disabled={isUninstallingServer || serverRunning}
                        style={{
                          minWidth: "60px",
                          padding: "6px 12px",
                          fontSize: "0.85rem",
                          background: "linear-gradient(135deg, #ef4444, #dc2626)",
                          opacity: serverRunning ? 0.5 : 1,
                          cursor: serverRunning ? "not-allowed" : "pointer"
                        }}
                        title={serverRunning ? t("uninstallLiveKitDisabled") : ""}
                      >
                        {isUninstallingServer ? t("loading") : t("uninstall")}
                      </button>
                      <button
                        className={`server-toggle ${serverRunning ? "server-toggle--on" : ""}`}
                        type="button"
                        onClick={handleServerToggle}
                        disabled={(!serverRunning && hasServerUpdate) || isUpgradingServer}
                        style={{
                          opacity: ((!serverRunning && hasServerUpdate) || isUpgradingServer) ? 0.5 : 1,
                          cursor: ((!serverRunning && hasServerUpdate) || isUpgradingServer) ? "not-allowed" : "pointer"
                        }}
                        title={(!serverRunning && hasServerUpdate) ? t("updateLiveKitDisabled") : ""}
                      >
                        <span className="server-toggle__knob" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="server-status-indicator">
                <span className={`server-status-dot ${getServerStatusDot()}`} />
                {getServerStatusText()}
              </div>
              {serverInstallSuccess && (
                <div className="install-success-msg" style={{ color: "#10b981", fontSize: "0.85rem", marginTop: "8px" }}>
                  {t("liveKitSuccessInstalled")}
                </div>
              )}
              {serverUpgradeSuccess && (
                <div className="install-success-msg" style={{ color: "#10b981", fontSize: "0.85rem", marginTop: "8px" }}>
                  {t("liveKitSuccessUpdated")}
                </div>
              )}
              {serverUninstallSuccess && (
                <div className="install-success-msg" style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "8px" }}>
                  {t("liveKitSuccessUninstalled")}
                </div>
              )}
              {hasServerUpdate && serverUpdateInfo && (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ fontSize: "0.75rem", color: "rgba(251,191,36,0.7)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>{t("updatesAvailable")}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", background: "rgba(251,191,36,0.1)", borderRadius: "6px", border: "1px solid rgba(251,191,36,0.2)" }}>
                    <span style={{ fontSize: "0.83rem", color: "#fbbf24" }}>livekit-server</span>
                    <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>{serverUpdateInfo.current || "?"} → {serverUpdateInfo.latest || "?"}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="settings-group settings-toggle-group">
              <div className="settings-toggle-row">
                <div>
                  <label>{t("aiAgent")}</label>
                  <span className="settings-hint">{t("aiAgentDesc")}</span>
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  {agentExeExists && hasAgentUpdate && (
                    <button
                      className={`settings-btn-primary ${isUpgradingAgent ? "installing-anim" : ""}`}
                      type="button"
                      onClick={handleAgentUpgrade}
                      disabled={isUpgradingAgent || agentRunning}
                      style={{ 
                        minWidth: "100px", 
                        padding: "6px 12px", 
                        fontSize: "0.85rem",
                        background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                        color: "#451a03",
                        opacity: agentRunning ? 0.5 : 1,
                        cursor: agentRunning ? "not-allowed" : "pointer"
                      }}
                      title={agentRunning ? t("updateToLatest") : ""}
                    >
                      {isUpgradingAgent ? t("loading") : `${t("update")} (${agentUpdatePackages.length})`}
                    </button>
                  )}
                  
                  {!agentExeExists ? (
                    <button
                      className={`settings-btn-primary ${isInstallingAgent ? "installing-anim" : ""}`}
                      type="button"
                      onClick={handleAgentInstall}
                      disabled={isInstallingAgent}
                      style={{ minWidth: "80px", padding: "8px 16px" }}
                    >
                      {isInstallingAgent ? t("loading") : t("install")}
                    </button>
                  ) : (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button
                        className={`settings-btn-primary ${isUninstallingAgent ? "installing-anim" : ""}`}
                        type="button"
                        onClick={handleAgentUninstall}
                        disabled={isUninstallingAgent || agentRunning}
                        style={{ 
                          minWidth: "60px", 
                          padding: "6px 12px", 
                          fontSize: "0.85rem",
                          background: "linear-gradient(135deg, #ef4444, #dc2626)",
                          opacity: agentRunning ? 0.5 : 1,
                          cursor: agentRunning ? "not-allowed" : "pointer"
                        }}
                      >
                        {isUninstallingAgent ? t("loading") : t("uninstall")}
                      </button>
                      <button
                        className={`server-toggle ${agentRunning ? "server-toggle--on" : ""}`}
                        type="button"
                        onClick={handleAgentToggle}
                        disabled={(!agentRunning && hasAgentUpdate) || isUpgradingAgent}
                        style={{ 
                          opacity: ((!agentRunning && hasAgentUpdate) || isUpgradingAgent) ? 0.5 : 1,
                          cursor: ((!agentRunning && hasAgentUpdate) || isUpgradingAgent) ? "not-allowed" : "pointer"
                        }}
                        title={(!agentRunning && hasAgentUpdate) ? t("updateToLatest") : ""}
                      >
                        <span className="server-toggle__knob" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="server-status-indicator">
                <span className={`server-status-dot ${getAgentStatusDot()}`} />
                {getAgentStatusText()}
              </div>
              {installSuccess && (
                <div className="install-success-msg" style={{ color: "#10b981", fontSize: "0.85rem", marginTop: "8px" }}>
                  {t("agentSuccessInstalled")}
                </div>
              )}
              {upgradeSuccess && (
                <div className="install-success-msg" style={{ color: "#10b981", fontSize: "0.85rem", marginTop: "8px" }}>
                  {t("agentSuccessUpdated")}
                </div>
              )}
              {hasAgentUpdate && agentUpdatePackages.length > 0 && (
                <div style={{ marginTop: "8px", maxHeight: "100px", overflowY: "auto" }}>
                  <div style={{ fontSize: "0.75rem", color: "rgba(251,191,36,0.7)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>{t("updatesAvailable")}</div>
                  {agentUpdatePackages.map((pkg) => (
                    <div key={pkg.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", background: "rgba(251,191,36,0.1)", borderRadius: "6px", marginBottom: "3px", border: "1px solid rgba(251,191,36,0.2)" }}>
                      <span style={{ fontSize: "0.83rem", color: "#fbbf24" }}>{pkg.name}</span>
                      <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>{pkg.current} → {pkg.latest}</span>
                    </div>
                  ))}
                </div>
              )}
              {uninstallSuccess && (
                <div className="install-success-msg" style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "8px" }}>
                  {t("agentSuccessUninstalled")}
                </div>
              )}
            </div>

            <div className="settings-group settings-toggle-group">
              <div className="settings-toggle-row">
                <div>
                  <label>{t("agentMemory")}</label>
                  <span className="settings-hint">{t("agentMemoryDesc")}</span>
                </div>
                <button
                  className={`settings-btn-primary ${isClearingHistory ? "installing-anim" : ""}`}
                  type="button"
                  onClick={handleClearHistory}
                  disabled={isClearingHistory || agentRunning || !hasHistoryFile}
                  style={{ 
                    minWidth: "120px", 
                    padding: "8px 16px",
                    background: "linear-gradient(135deg, #6b7280, #374151)",
                    opacity: (agentRunning || !hasHistoryFile) ? 0.5 : 1,
                    cursor: (agentRunning || !hasHistoryFile) ? "not-allowed" : "pointer"
                  }}
                  title={agentRunning ? t("clearHistoryDisabled") : (!hasHistoryFile ? t("clearHistoryEmpty") : "")}
                >
                  {isClearingHistory ? t("loading") : t("clearMemory")}
                </button>
              </div>
              {clearHistorySuccess && (
                <div className="install-success-msg" style={{ color: "#10b981", fontSize: "0.85rem", marginTop: "8px" }}>
                  {t("clearHistorySuccess")}
                </div>
              )}
            </div>

            {/* ── Plugin Management ──────────────────────────────── */}
            <div className="settings-group" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "16px" }}>
              <label style={{ fontSize: "1rem", fontWeight: "600" }}>{t("pluginMgmt")}</label>

              {/* pip install */}
              <div style={{ marginTop: "12px" }}>
                <label style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>{t("installWithPip")}</label>
                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                  <input
                    type="text"
                    value={pipPluginInput}
                    onChange={(e) => setPipPluginInput(e.target.value)}
                    placeholder={t("pipPlaceholder")}
                    style={{ flex: 1, padding: "8px 12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#fff", fontSize: "0.9rem" }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleInstallPipPlugin(); } }}
                  />
                  <button
                    className="settings-btn-primary"
                    type="button"
                    onClick={handleInstallPipPlugin}
                    disabled={isInstallingPipPlugin || !pipPluginInput.trim()}
                    style={{ minWidth: "80px", padding: "8px 14px", opacity: (isInstallingPipPlugin || !pipPluginInput.trim()) ? 0.5 : 1 }}
                  >
                    {isInstallingPipPlugin ? t("loading") : t("update")}
                  </button>
                </div>
                {pipInstallMsg && (
                  <div style={{ fontSize: "0.85rem", marginTop: "6px", color: pipInstallMsg.type === "success" ? "#10b981" : "#f87171" }}>
                    {pipInstallMsg.text}
                  </div>
                )}
              </div>

              {/* local zip install */}
              <div style={{ marginTop: "12px" }}>
                <label style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>{t("localPluginZip")}</label>
                <div style={{ display: "flex", gap: "8px", marginTop: "6px", alignItems: "center" }}>
                  <button
                    className="settings-btn-primary"
                    type="button"
                    onClick={handleInstallLocalPlugin}
                    disabled={isInstallingLocalPlugin}
                    style={{ minWidth: "120px", padding: "8px 14px", background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}
                  >
                    {isInstallingLocalPlugin ? t("loading") : t("zipInstall")}
                  </button>
                  <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.45)" }}>{t("zipHint")}</span>
                </div>
                {localInstallMsg && (
                  <div style={{ fontSize: "0.85rem", marginTop: "6px", color: localInstallMsg.type === "success" ? "#10b981" : "#f87171" }}>
                    {localInstallMsg.text}
                  </div>
                )}
              </div>

              {/* installed plugin list */}
              <div style={{ marginTop: "14px" }}>
                <label style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>{t("installedPlugins")}</label>
                <button
                  type="button"
                  onClick={listPlugins}
                  disabled={pluginsLoading}
                  style={{ marginLeft: "10px", fontSize: "0.8rem", padding: "3px 8px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", color: "rgba(255,255,255,0.7)", cursor: "pointer" }}
                >
                  {pluginsLoading ? t("loading") : t("refresh")}
                </button>
                <div style={{ marginTop: "8px", maxHeight: "160px", overflowY: "auto" }}>
                  {plugins.local.length > 0 && (
                    <div style={{ marginBottom: "8px" }}>
                      <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>{t("localPlugins")}</div>
                      {plugins.local.map((name) => (
                        <div key={name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "rgba(99,102,241,0.12)", borderRadius: "6px", marginBottom: "4px", border: "1px solid rgba(99,102,241,0.2)" }}>
                          <span style={{ fontSize: "0.85rem", color: "#c7d2fe" }}>{name}</span>
                          <button
                            type="button"
                            onClick={() => handleUninstallLocalPlugin(name)}
                            style={{ fontSize: "0.75rem", padding: "2px 8px", background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "5px", color: "#f87171", cursor: "pointer" }}
                          >
                            {t("uninstall")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {plugins.pip.length > 0 && (
                    <div>
                      <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>{t("pipPackages")}</div>
                      {plugins.pip.map((pkg) => (
                        <div key={pkg.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "rgba(255,255,255,0.05)", borderRadius: "6px", marginBottom: "4px", border: "1px solid rgba(255,255,255,0.08)" }}>
                          <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.8)" }}>
                            {pkg.name} <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.75rem" }}>v{pkg.version}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUninstallPipPlugin(pkg.name)}
                            style={{ fontSize: "0.75rem", padding: "2px 8px", background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "5px", color: "#f87171", cursor: "pointer" }}
                          >
                            {t("uninstall")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {plugins.local.length === 0 && plugins.pip.length === 0 && !pluginsLoading && (
                    <div style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "12px" }}>{t("noPlugins")}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="settings-info-box">
              {t("settingsHintSaved")}
            </div>

            <div className="settings-actions">
              {settingsSaveStatus === "success" && (
                <span className="settings-status-msg success">{t("settingsSaved")}</span>
              )}
              {settingsSaveStatus === "error" && (
                <span className="settings-status-msg error">{t("failedToSave")}</span>
              )}
              {settingsSaveStatus === "saving" && (
                <span className="settings-status-msg">{t("saving")}</span>
              )}
              
              <button
                className="settings-btn-secondary"
                type="button"
                onClick={() => setIsSettingsOpen(false)}
              >
                {t("close")}
              </button>
              <button
                className="settings-btn-primary"
                type="submit"
                disabled={settingsSaveStatus === "saving"}
              >
                {t("save")}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  if (isConnected) {
    return (
      <LiveKitRoom
        token={connection.participantToken}
        serverUrl={connection.serverUrl}
        connect={true}
        audio={true}
        video={true}
        onDisconnected={handleDisconnect}
      >
        <RoomAudioRenderer />
        <LiveKitStateSync updateOverlayState={updateOverlayState} />
        {renderContent()}
        {renderSettingsModal()}
      </LiveKitRoom>
    );
  }

  return (
    <>
      {renderContent()}
      {renderSettingsModal()}
    </>
  );
}
