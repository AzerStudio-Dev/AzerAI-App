const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("livekit", {
  getConnectionDetails: () => ipcRenderer.invoke("livekit:get-connection-details"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  serverStatus: () => ipcRenderer.invoke("livekit-server:status"),
  serverStart: () => ipcRenderer.invoke("livekit-server:start"),
  serverStop: () => ipcRenderer.invoke("livekit-server:stop"),
  serverCheckUpdate: () => ipcRenderer.invoke("livekit-server:check-update"),
  serverInstall: () => ipcRenderer.invoke("livekit-server:install"),
  serverUpgrade: () => ipcRenderer.invoke("livekit-server:upgrade"),
  serverUninstall: () => ipcRenderer.invoke("livekit-server:uninstall"),
  agentStatus: () => ipcRenderer.invoke("agent:status"),
  agentStart: () => ipcRenderer.invoke("agent:start"),
  agentStop: () => ipcRenderer.invoke("agent:stop"),
  agentCheckPython: () => ipcRenderer.invoke("agent:check-python"),
  agentInstallPython: () => ipcRenderer.invoke("agent:install-python"),
  agentCreateVenv: () => ipcRenderer.invoke("agent:create-venv"),
  agentInstall: () => ipcRenderer.invoke("agent:install"),
  agentCheckExe: () => ipcRenderer.invoke("agent:check-exe"),
  agentCheckUpdate: () => ipcRenderer.invoke("agent:check-update"),
  agentUpgrade: (packageNames) => ipcRenderer.invoke("agent:upgrade", packageNames),
  agentUninstall: () => ipcRenderer.invoke("agent:uninstall"),
  agentClearHistory: () => ipcRenderer.invoke("agent:clear-history"),
  agentCheckHistory: () => ipcRenderer.invoke("agent:check-history"),

  // Plugin management
  pluginList: () => ipcRenderer.invoke("plugin:list"),
  pluginInstallPip: (name) => ipcRenderer.invoke("plugin:install-pip", name),
  pluginUninstallPip: (name) => ipcRenderer.invoke("plugin:uninstall-pip", name),
  pluginInstallLocal: () => ipcRenderer.invoke("plugin:install-local"),
  pluginUninstallLocal: (name) => ipcRenderer.invoke("plugin:uninstall-local", name),

  checkAppUpdate: () => ipcRenderer.invoke("app-update:check"),
  downloadAppUpdate: () => ipcRenderer.invoke("app-update:download"),
  startBackend: () => ipcRenderer.invoke("app:start-backend"),
  onUpdateDownloadProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("app-update:download-progress", listener);
    return () => {
      ipcRenderer.removeListener("app-update:download-progress", listener);
    };
  },

  // Mini AzerAI overlay control
  azeraiUpdateState: (state) => ipcRenderer.invoke("azerai:update-state", state),
  azeraiShow: () => ipcRenderer.invoke("azerai:show"),
  azeraiHide: () => ipcRenderer.invoke("azerai:hide"),
  azeraiSetEnabled: (enabled) => ipcRenderer.invoke("azerai:set-enabled", enabled),
  azeraiIsEnabled: () => ipcRenderer.invoke("azerai:is-enabled"),

  // Caption overlay control
  captionShow: () => ipcRenderer.invoke("caption:show"),
  captionHide: () => ipcRenderer.invoke("caption:hide"),
  captionSend: (data) => ipcRenderer.invoke("caption:send", data),

  getSystemLanguage: () => ipcRenderer.invoke("app:get-system-language"),

  onLanguageChanged: (callback) => {
    const listener = (_event, lang) => callback(lang);
    ipcRenderer.on("app:language-changed", listener);
    return () => {
      ipcRenderer.removeListener("app:language-changed", listener);
    };
  },

  onToggleMicrophone: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:toggle-microphone", listener);
    return () => {
      ipcRenderer.removeListener("app:toggle-microphone", listener);
    };
  },
  toggleMicrophone: () => ipcRenderer.invoke("azerai:toggle-microphone"),

  onToggleCamera: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:toggle-camera", listener);
    return () => {
      ipcRenderer.removeListener("app:toggle-camera", listener);
    };
  },
  toggleCamera: () => ipcRenderer.invoke("azerai:toggle-camera"),

  onToggleScreenShare: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:toggle-screenshare", listener);
    return () => {
      ipcRenderer.removeListener("app:toggle-screenshare", listener);
    };
  },
  toggleScreenShare: () => ipcRenderer.invoke("azerai:toggle-screenshare"),
});
