const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  desktopCapturer,
  Menu,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const http = require("http");
const https = require("https");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const dotenv = require("dotenv");
const { getConnectionDetails } = require("./livekit-token");
const {
  checkForUpdate,
  downloadUpdate,
} = require("./github-update");

const appPackage = require("../package.json");

let mainWindow = null;

// ====== MINI AZERAI OVERLAY WINDOW ======
let azeraiWindow = null;
let azeraiState = { connected: false, speaking: false, thinking: false, listening: false, audioLevel: 0, agentState: 'disconnected', tool: false, toolName: '', language: 'az', microphoneEnabled: true, cameraEnabled: false, screenShareEnabled: false };
let overlayEnabled = true; // default enabled, will be overridden by settings
let azeraiPosition = { x: 0, y: 0 }; // Track AzerAI position

function isOverlayEnabled() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (saved.OVERLAY_ENABLED === false) return false;
    }
  } catch (e) {}
  return true;
}

function createAzeraiOverlay() {
  // Only create if overlay is enabled in settings
  overlayEnabled = isOverlayEnabled();
  if (!overlayEnabled) return;

  // Load language setting
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (saved.APP_LANG) {
        azeraiState.language = saved.APP_LANG;
      }
    }
  } catch (e) {}

  const { width, height } = require("electron").screen.getPrimaryDisplay().workAreaSize;

  azeraiWindow = new BrowserWindow({
    width: 280,
    height: 280,
    x: width - 300,
    y: height - 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false, // hidden by default
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  azeraiWindow.loadFile(path.join(__dirname, "overlay", "index.html"));
  azeraiWindow.setVisibleOnAllWorkspaces(true, { skipTransform: true });

  // Show overlay as soon as it's ready (with current state - connected or not)
  azeraiWindow.webContents.on("did-finish-load", () => {
    if (overlayEnabled) {
      azeraiWindow.showInactive();
      sendAzeraiState();
      azeraiWindow.webContents.send("azerai:set-version", appPackage.version);
    }
  });

  // Track position changes and move caption with it
  azeraiWindow.on("moved", () => {
    if (azeraiWindow && !azeraiWindow.isDestroyed()) {
      const pos = azeraiWindow.getBounds();
      azeraiPosition = { x: pos.x, y: pos.y };
      repositionCaptionOverlay();
    }
  });

  azeraiWindow.on("closed", () => {
    azeraiWindow = null;
  });
}

function sendAzeraiState() {
  if (azeraiWindow && !azeraiWindow.isDestroyed()) {
    azeraiWindow.webContents.send("azerai:state", azeraiState);
  }
}

// Make the overlay window visible (does NOT change connection state)
function showAzeraiWindow() {
  if (!overlayEnabled) return;
  if (azeraiWindow && !azeraiWindow.isDestroyed()) {
    azeraiWindow.showInactive();
  }
}

// Completely hide the overlay window (used only when overlay is disabled)
function hideAzeraiWindow() {
  if (azeraiWindow && !azeraiWindow.isDestroyed()) {
    azeraiWindow.hide();
    hideCaptionOverlay();
  }
}

// IPC handlers for Mini AzerAI overlay control
ipcMain.handle("azerai:show", () => showAzeraiWindow());
ipcMain.handle("azerai:hide", () => hideAzeraiWindow());
ipcMain.handle("azerai:update-state", (_, state) => {
  // If overlay is disabled, ignore all state updates
  if (!overlayEnabled) return;

  if (state.connected !== undefined) azeraiState.connected = state.connected;
  if (state.speaking !== undefined) azeraiState.speaking = state.speaking;
  if (state.thinking !== undefined) azeraiState.thinking = state.thinking;
  if (state.listening !== undefined) azeraiState.listening = state.listening;
  if (state.audioLevel !== undefined) azeraiState.audioLevel = state.audioLevel;
  if (state.agentState !== undefined) azeraiState.agentState = state.agentState;
  if (state.tool !== undefined) azeraiState.tool = state.tool;
  if (state.toolName !== undefined) azeraiState.toolName = state.toolName;
  if (state.language !== undefined) azeraiState.language = state.language;
  if (state.microphoneEnabled !== undefined) azeraiState.microphoneEnabled = state.microphoneEnabled;
  if (state.cameraEnabled !== undefined) azeraiState.cameraEnabled = state.cameraEnabled;
  if (state.screenShareEnabled !== undefined) azeraiState.screenShareEnabled = state.screenShareEnabled;

  // Reset sub-states when disconnected
  if (state.connected === false) {
    azeraiState.speaking = false;
    azeraiState.thinking = false;
    azeraiState.listening = false;
    azeraiState.audioLevel = 0;
    azeraiState.agentState = 'disconnected';
    azeraiState.tool = false;
    azeraiState.toolName = '';
    azeraiState.microphoneEnabled = false;
    azeraiState.cameraEnabled = false;
    azeraiState.screenShareEnabled = false;
    hideCaptionOverlay(); // clear captions on disconnect
  }

  // Show captions only when connected
  if (state.connected === true) {
    showCaptionOverlay();
  }

  sendAzeraiState();
});

// IPC: enable/disable overlay and persist to settings
ipcMain.handle("azerai:set-enabled", (_, enabled) => {
  overlayEnabled = enabled;

  // Persist to setting.json
  try {
    const settingsPath = getSettingsPath();
    let current = {};
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
    current.OVERLAY_ENABLED = enabled;
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), "utf-8");
  } catch (e) {
    console.error("Overlay ayar saxlama xetasi:", e);
  }

  if (enabled) {
    // Re-create overlay windows if they don't exist
    if (!azeraiWindow) createAzeraiOverlay();
    if (!captionWindow) createCaptionOverlay();
    // Show overlay immediately with current state (connected or not)
    showAzeraiWindow();
    sendAzeraiState();
  } else {
    // Immediately hide overlay and caption
    hideAzeraiWindow();
  }

  return { success: true, enabled };
});

ipcMain.handle("azerai:is-enabled", () => {
  return overlayEnabled;
});

ipcMain.handle("azerai:change-language", (_, newLang) => {
  try {
    const settingsPath = getSettingsPath();
    let current = {};
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
    current.APP_LANG = newLang;
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to save language from overlay:", error);
  }

  // Update azeraiState language so overlay gets immediate feedback
  azeraiState.language = newLang;
  sendAzeraiState();

  // Notify main window to update its language context
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:language-changed", newLang);
  }

  return { success: true };
});

ipcMain.handle("azerai:toggle-microphone", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:toggle-microphone");
  }
  return { success: true };
});

ipcMain.handle("azerai:toggle-camera", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:toggle-camera");
  }
  return { success: true };
});

ipcMain.handle("azerai:toggle-screenshare", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:toggle-screenshare");
  }
  return { success: true };
});
// ====== END MINI AZERAI OVERLAY ======

// ====== CAPTION OVERLAY WINDOW ======
let captionWindow = null;

function createCaptionOverlay() {
  const { width, height } = require("electron").screen.getPrimaryDisplay().workAreaSize;
  const captionWidth = 520;
  const captionHeight = 240;

  // Position relative to AzerAI overlay if it exists
  let captionX, captionY;
  if (azeraiWindow && !azeraiWindow.isDestroyed()) {
    const azeraiBounds = azeraiWindow.getBounds();
    captionX = azeraiBounds.x + Math.floor((azeraiBounds.width - captionWidth) / 2);
    captionY = azeraiBounds.y - captionHeight - 10; // ABOVE AzerAI
    azeraiPosition = { x: azeraiBounds.x, y: azeraiBounds.y };
  } else {
    // Default position (right side, vertically centered)
    captionX = width - captionWidth - 20;
    captionY = Math.floor(height / 2 - captionHeight / 2);
  }

  captionWindow = new BrowserWindow({
    width: captionWidth,
    height: captionHeight,
    x: captionX,
    y: captionY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false, // hidden by default
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  captionWindow.loadFile(path.join(__dirname, "caption-overlay", "index.html"));
  captionWindow.setVisibleOnAllWorkspaces(true, { skipTransform: true });
  captionWindow.setIgnoreMouseEvents(true); // click-through

  captionWindow.on("closed", () => {
    captionWindow = null;
  });
}

function showCaptionOverlay() {
  if (captionWindow && !captionWindow.isDestroyed()) {
    repositionCaptionOverlay();
    captionWindow.showInactive();
  }
}

function hideCaptionOverlay() {
  if (captionWindow && !captionWindow.isDestroyed()) {
    captionWindow.hide();
    captionWindow.webContents.send("caption:clear");
  }
}

function repositionCaptionOverlay() {
  if (!captionWindow || captionWindow.isDestroyed()) return;
  if (!azeraiWindow || azeraiWindow.isDestroyed()) return;

  const azeraiBounds = azeraiWindow.getBounds();
  const captionBounds = captionWindow.getBounds();
  
  // Position caption overlay ABOVE the AzerAI overlay
  const newX = azeraiBounds.x + Math.floor((azeraiBounds.width - captionBounds.width) / 2);
  const newY = azeraiBounds.y - captionBounds.height - 10; // 10px gap above

  // Check if it would go off screen
  const { width: screenWidth, height: screenHeight } = require("electron").screen.getPrimaryDisplay().workAreaSize;
  const finalX = Math.max(0, Math.min(newX, screenWidth - captionBounds.width));
  const finalY = Math.max(0, Math.min(newY, screenHeight - captionBounds.height));

  captionWindow.setPosition(finalX, finalY);
}

function sendCaptionUpdate(data) {
  if (captionWindow && !captionWindow.isDestroyed()) {
    captionWindow.webContents.send("caption:update", data);
  }
}

// IPC handlers for caption overlay
ipcMain.handle("caption:show", () => showCaptionOverlay());
ipcMain.handle("caption:hide", () => hideCaptionOverlay());
ipcMain.handle("caption:send", (_, data) => sendCaptionUpdate(data));
// ====== END CAPTION OVERLAY ======

const DEV_SERVER_URL = "http://127.0.0.1:5173";
let screenPickerWindow = null;

// Show screen/window picker dialog
function showSourcePicker(sources) {
  return new Promise((resolve) => {
    if (screenPickerWindow && !screenPickerWindow.isDestroyed()) {
      screenPickerWindow.close();
    }

    const { width, height } = require("electron").screen.getPrimaryDisplay().workAreaSize;
    const pickerWidth = 600;
    const pickerHeight = 500;

    screenPickerWindow = new BrowserWindow({
      width: pickerWidth,
      height: pickerHeight,
      x: Math.floor((width - pickerWidth) / 2),
      y: Math.floor((height - pickerHeight) / 2),
      title: "AzerAI App - Ekran Paylaşma",
      icon: path.join(__dirname, "..", "public", "icon.png"),
      frame: true,
      resizable: false,
      modal: true,
      parent: BrowserWindow.getAllWindows()[0],
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    const pickerHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #1a1a2e;
            color: #e5e7eb;
            padding: 20px;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
          }
          h2 { 
            color: #00ffe5;
            font-size: 1.3rem;
            flex: 1;
            text-align: center;
          }
          .tabs {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
          }
          .tab {
            flex: 1;
            padding: 10px;
            background: rgba(255,255,255,0.1);
            border: 2px solid transparent;
            border-radius: 8px;
            cursor: pointer;
            text-align: center;
            transition: all 0.2s;
          }
          .tab.active {
            background: rgba(0, 255, 229, 0.2);
            border-color: #00ffe5;
          }
          .tab:hover {
            background: rgba(255,255,255,0.15);
          }
          .sources-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            max-height: 320px;
            overflow-y: auto;
            padding-right: 5px;
          }
          .source-card {
            background: rgba(255,255,255,0.05);
            border: 2px solid transparent;
            border-radius: 10px;
            padding: 10px;
            cursor: pointer;
            transition: all 0.2s;
          }
          .source-card:hover {
            background: rgba(255,255,255,0.1);
            border-color: rgba(0, 255, 229, 0.5);
            transform: scale(1.02);
          }
          .source-card img {
            width: 100%;
            height: 120px;
            object-fit: cover;
            border-radius: 6px;
            background: #000;
          }
          .source-card .name {
            margin-top: 8px;
            font-size: 0.85rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .cancel-btn {
            display: block;
            width: 100%;
            margin-top: 20px;
            padding: 12px;
            background: rgba(239, 68, 68, 0.2);
            border: 1px solid rgba(239, 68, 68, 0.5);
            color: #f87171;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.95rem;
            transition: all 0.2s;
          }
          .cancel-btn:hover {
            background: rgba(239, 68, 68, 0.3);
          }
          .empty {
            text-align: center;
            padding: 40px;
            color: #9ca3af;
          }
          ::-webkit-scrollbar { width: 4px; }
          ::-webkit-scrollbar-track { background: rgba(255,255,255,0.05); border-radius: 2px; }
          ::-webkit-scrollbar-thumb { background: rgba(0,255,229,0.3); border-radius: 2px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2 id="titleText">🖥️ Ekran Paylaşımı</h2>
        </div>
        <div class="tabs">
          <div class="tab active" data-type="screen" id="tabScreen">🖥️ Ekranlar</div>
          <div class="tab" data-type="window" id="tabWindow">🪟 Pencereler</div>
        </div>
        <div class="sources-grid" id="sourcesGrid"></div>
        <button class="cancel-btn" id="cancelBtn">İmtina et</button>
        <script>
          const { ipcRenderer } = require('electron');
          let allSources = ${JSON.stringify(sources)};
          let currentType = 'screen';
          const currentLang = '${azeraiState.language || 'az'}';

          const TEXTS = {
            az: {
              title: '🖥️ Ekran Paylaşımı',
              screens: '🖥️ Ekranlar',
              windows: '🪟 Pəncərələr',
              cancel: 'İmtina et',
              empty: 'Mənbə tapılmadı'
            },
            tr: {
              title: '🖥️ Ekran Paylaşımı',
              screens: '🖥️ Ekranlar',
              windows: '🪟 Pencereler',
              cancel: 'İptal',
              empty: 'Kaynak bulunamadı'
            },
            en: {
              title: '🖥️ Screen Share',
              screens: '🖥️ Screens',
              windows: '🪟 Windows',
              cancel: 'Cancel',
              empty: 'No sources found'
            }
          };

          const t = TEXTS[currentLang] || TEXTS.az;
          document.getElementById('titleText').textContent = t.title;
          document.getElementById('tabScreen').textContent = t.screens;
          document.getElementById('tabWindow').textContent = t.windows;
          document.getElementById('cancelBtn').textContent = t.cancel;

          function renderSources(type) {
            const grid = document.getElementById('sourcesGrid');
            const t = TEXTS[currentLang] || TEXTS.az;
            const filtered = allSources.filter(s => 
              type === 'screen' ? s.id.startsWith('screen:') : s.id.startsWith('window:')
            );
            
            if (filtered.length === 0) {
              grid.innerHTML = '<div class="empty">' + t.empty + '</div>';
              return;
            }

            grid.innerHTML = filtered.map(source => \`
              <div class="source-card" data-id="\${source.id}">
                <img src="\${source.thumbnail}" alt="\${source.name}">
                <div class="name">\${source.name}</div>
              </div>
            \`).join('');

            grid.querySelectorAll('.source-card').forEach(card => {
              card.onclick = () => {
                ipcRenderer.send('screen-picker:select', card.dataset.id);
              };
            });
          }

          document.querySelectorAll('.tab').forEach(tab => {
            tab.onclick = () => {
              document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
              tab.classList.add('active');
              currentType = tab.dataset.type;
              renderSources(currentType);
            };
          });

          document.getElementById('cancelBtn').onclick = () => {
            ipcRenderer.send('screen-picker:cancel');
          };

          // Initialize with screen sources
          renderSources('screen');
        </script>
      </body>
      </html>
    `;

    screenPickerWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pickerHTML));

    // Use named handlers so we can remove them in all exit paths
    function onPickerSelect(event, sourceId) {
      cleanup();
      if (screenPickerWindow && !screenPickerWindow.isDestroyed()) {
        screenPickerWindow.close();
      }
      screenPickerWindow = null;
      resolve(sourceId);
    }

    function onPickerCancel() {
      cleanup();
      if (screenPickerWindow && !screenPickerWindow.isDestroyed()) {
        screenPickerWindow.close();
      }
      screenPickerWindow = null;
      resolve(null);
    }

    function cleanup() {
      ipcMain.removeListener('screen-picker:select', onPickerSelect);
      ipcMain.removeListener('screen-picker:cancel', onPickerCancel);
    }

    ipcMain.on('screen-picker:select', onPickerSelect);
    ipcMain.on('screen-picker:cancel', onPickerCancel);

    // If user closes via X button — treat as cancel and clean up listeners
    screenPickerWindow.on('closed', () => {
      cleanup();
      screenPickerWindow = null;
      resolve(null); // Unblock the promise so the next open works
    });
  });
}


function loadEnv() {
  const envPaths = [
    path.join(__dirname, "..", ".env.local"),
    path.join(process.resourcesPath, ".env"),
  ];

  for (const envPath of envPaths) {
    dotenv.config({ path: envPath });
  }
}

loadEnv();

let livekitProcess = null;
let livekitStatus = "stopped"; // starting, active, stopping, stopped
let agentProcess = null;
let agentStatus = "stopped"; // starting, active, stopping, stopped
let backendServicesStarted = false;
let pendingUpdateInfo = null;
let serverSettingsBackup = null; // In-memory fallback if DEFAULTS not in file

const LIVEKIT_RELEASE_API = "https://api.github.com/repos/livekit/livekit/releases/latest";

function getExecutableSuffix() {
  return process.platform === "win32" ? ".exe" : "";
}

function getManagedLiveKitDir() {
  // Proje kök dizininde livekit-server klasörüne kur
  if (!app.isPackaged) {
    return path.join(__dirname, "..", "livekit-server");
  }
  // Packaged app için resources klasörüne kur
  return path.join(process.resourcesPath, "livekit-server");
}

function getManagedLiveKitServerPath() {
  return path.join(getManagedLiveKitDir(), `livekit-server${getExecutableSuffix()}`);
}

function getBundledLiveKitServerPath() {
  const fileName = `livekit-server${getExecutableSuffix()}`;
  if (!app.isPackaged) {
    return path.join(__dirname, "..", "livekit-server", fileName);
  }
  return path.join(process.resourcesPath, fileName);
}

function findSystemLiveKitServerPath() {
  const candidates = process.platform === "darwin"
    ? [
        "/opt/homebrew/bin/livekit-server",
        "/usr/local/bin/livekit-server",
        "/opt/homebrew/bin/livekit",
        "/usr/local/bin/livekit",
      ]
    : [
        "/usr/local/bin/livekit-server",
        "/usr/bin/livekit-server",
        "/snap/bin/livekit-server",
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function getLiveKitServerPath() {
  const managedPath = getManagedLiveKitServerPath();
  if (fs.existsSync(managedPath)) {
    return managedPath;
  }
  const systemPath = findSystemLiveKitServerPath();
  if (systemPath) {
    return systemPath;
  }
  return getBundledLiveKitServerPath();
}

function parseVersionText(text) {
  const match = String(text || "").match(/v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

function normalizeSemver(version) {
  return String(version || "").trim().replace(/^v/i, "").split(/[+-]/)[0];
}

function compareSemver(a, b) {
  const left = normalizeSemver(a).split(".").map((part) => parseInt(part, 10) || 0);
  const right = normalizeSemver(b).split(".").map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getLiveKitInstalledVersion(binaryPath = getLiveKitServerPath()) {
  if (!fs.existsSync(binaryPath)) return null;

  const attempts = [
    [binaryPath, ["--version"]],
    [binaryPath, ["version"]],
  ];

  for (const [cmd, args] of attempts) {
    try {
      const result = spawnSync(cmd, args, {
        encoding: "utf-8",
        windowsHide: true,
        timeout: 5000,
      });
      const text = `${result.stdout || ""}\n${result.stderr || ""}`;
      const version = parseVersionText(text);
      if (version) return version;
    } catch (_) {}
  }

  return null;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "AzerAI-LiveKit-Manager",
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          requestJson(res.headers.location).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API error: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("GitHub request timed out")));
  });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const requestFile = (targetUrl) => {
      const req = https.get(targetUrl, { headers: { "User-Agent": "AzerAI-LiveKit-Manager" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          requestFile(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download error: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const stream = fs.createWriteStream(destination);
        res.pipe(stream);
        stream.on("finish", () => stream.close(() => resolve(destination)));
        stream.on("error", (error) => {
          fs.unlink(destination, () => reject(error));
        });
      });
      req.on("error", reject);
      req.setTimeout(180000, () => req.destroy(new Error("Download timed out")));
    };
    requestFile(url);
  });
}

function getLiveKitArchWords() {
  if (process.arch === "arm64") return ["arm64", "aarch64"];
  if (process.arch === "x64") return ["amd64", "x64", "x86_64"];
  return [process.arch];
}

function pickLiveKitReleaseAsset(assets = []) {
  const platformWords = process.platform === "win32"
    ? ["windows", "win"]
    : process.platform === "linux"
      ? ["linux"]
      : ["darwin", "macos", "mac"];
  const archWords = getLiveKitArchWords();

  const candidates = assets.filter((asset) => {
    const name = (asset.name || "").toLowerCase();
    const isArchive = /\.(zip|tar\.gz|tgz)$/i.test(name);
    return isArchive
      && platformWords.some((word) => name.includes(word))
      && archWords.some((word) => name.includes(word));
  });

  return candidates[0] || null;
}

async function getLiveKitLatestReleaseInfo() {
  const release = await requestJson(LIVEKIT_RELEASE_API);
  const latestVersion = normalizeSemver(release.tag_name);
  const asset = pickLiveKitReleaseAsset(release.assets || []);
  return {
    latestVersion,
    downloadUrl: asset?.browser_download_url || null,
    assetName: asset?.name || null,
    releaseUrl: release.html_url,
  };
}

function findExtractedLiveKitBinary(rootDir) {
  const expected = `livekit-server${getExecutableSuffix()}`.toLowerCase();
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name.toLowerCase() === expected) {
        return fullPath;
      }
    }
  }
  return null;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { windowsHide: true, ...options });
    let stderr = "";
    proc.stderr?.on("data", (data) => { stderr += data.toString(); });
    proc.on("close", (code) => {
      resolve({ success: code === 0, code, error: stderr.slice(-500) });
    });
    proc.on("error", (error) => resolve({ success: false, error: error.message }));
  });
}

async function extractArchive(archivePath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (/\.zip$/i.test(archivePath) && process.platform === "win32") {
    return runCommand("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
    ]);
  }
  return runCommand("tar", ["-xf", archivePath, "-C", destination]);
}

async function installLiveKitFromRelease() {
  if (process.platform === "darwin") {
    const update = await runCommand("brew", ["update"]);
    if (!update.success) return update;
    return runCommand("brew", ["install", "livekit"]);
  }

  const release = await getLiveKitLatestReleaseInfo();
  if (!release.downloadUrl) {
    return { success: false, error: "LiveKit release asset tapılmadı" };
  }

  const tempDir = path.join(app.getPath("temp"), `azerai-livekit-${Date.now()}`);
  const archivePath = path.join(tempDir, path.basename(release.assetName || "livekit-server.zip"));
  const extractDir = path.join(tempDir, "extract");
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    await downloadFile(release.downloadUrl, archivePath);
    const extracted = await extractArchive(archivePath, extractDir);
    if (!extracted.success) return extracted;

    const binary = findExtractedLiveKitBinary(extractDir);
    if (!binary) return { success: false, error: "livekit-server binary tapılmadı" };

    const targetPath = getManagedLiveKitServerPath();
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(binary, targetPath);
    if (process.platform !== "win32") fs.chmodSync(targetPath, 0o755);

    return { success: true, version: release.latestVersion };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  }
}
function startLiveKitServer() {
  const serverPath = getLiveKitServerPath();
  if (!fs.existsSync(serverPath)) {
    console.warn("livekit-server tapilmadi:", serverPath);
    return;
  }

  const args = ["--dev", "--keys", "devkey: secret"];

  console.log("LiveKit server basladilir:", serverPath, args.join(" "));
  livekitStatus = "starting";

  livekitProcess = spawn(serverPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let outputBuffer = "";
  livekitProcess.stdout.on("data", (data) => {
    const text = data.toString();
    console.log("[livekit-server]", text.trim());
    outputBuffer += text;
    // Server hazirdir - "single-node routing" sozunu axtar
    if (outputBuffer.includes("single-node routing")) {
      livekitStatus = "active";
    }
  });

  livekitProcess.stderr.on("data", (data) => {
    const text = data.toString();
    console.error("[livekit-server]", text.trim());
    outputBuffer += text;
    if (outputBuffer.includes("single-node routing")) {
      livekitStatus = "active";
    }
  });

  livekitProcess.on("error", (err) => {
    console.error("livekit-server baslama xetasi:", err);
    livekitStatus = "stopped";
  });

  livekitProcess.on("exit", (code) => {
    console.log("livekit-server cixdi, kod:", code);
    livekitProcess = null;
    livekitStatus = "stopped";
  });
}

function stopLiveKitServer() {
  if (livekitProcess) {
    console.log("livekit-server dayandirilir...");
    livekitStatus = "stopping";
    const pid = livekitProcess.pid;
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
          detached: true,
        });
      } else {
        livekitProcess.kill("SIGTERM");
      }
    } catch (e) {
      console.error("Server dayandirma xetasi:", e);
      livekitStatus = "stopped";
    }
    livekitProcess = null;
  }
}

function getAgentPath() {
  if (!app.isPackaged) {
    return path.join(__dirname, "..", "agent");
  }
  return path.join(process.resourcesPath, "agent");
}

function startAgent() {
  const agentDir = getAgentPath();
  const azeraiExe = process.platform === "win32"
    ? path.join(agentDir, "venv", "Scripts", "azerai.exe")
    : path.join(agentDir, "venv", "bin", "azerai");

  if (!fs.existsSync(azeraiExe)) {
    console.warn("azerai tapilmadi:", azeraiExe);
    return;
  }

  // Get launch mode from settings
  let launchMode = "start"; // Default
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      launchMode = saved.AGENT_LAUNCH_MODE || "start";
    }
  } catch (e) {}

  console.log(`Agent basladilir: ${azeraiExe} ${launchMode}`);
  agentStatus = "starting";

  // Directly run azerai from venv with proper environment
  const venvScripts = process.platform === "win32"
    ? path.join(agentDir, "venv", "Scripts")
    : path.join(agentDir, "venv", "bin");

  const pathSeparator = process.platform === "win32" ? ";" : ":";

  const agentEnv = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    // Ensure venv paths are first in PATH
    PATH: `${venvScripts}${pathSeparator}${process.env.PATH}`
  };

  agentProcess = spawn(azeraiExe, [launchMode], {
    cwd: agentDir,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: agentEnv,
  });

  let outputBuffer = "";
  agentProcess.stdout.on("data", (data) => {
    const text = data.toString();
    console.log("[agent]", text.trim());
    outputBuffer += text;
    // Agent hazirdir - "HTTP server listening" sozunu axtar
    if (outputBuffer.includes("HTTP server listening")) {
      agentStatus = "active";
    }
  });

  agentProcess.stderr.on("data", (data) => {
    const text = data.toString();
    console.error("[agent]", text.trim());
    outputBuffer += text;
    if (outputBuffer.includes("HTTP server listening")) {
      agentStatus = "active";
    }
  });

  agentProcess.on("error", (err) => {
    console.error("Agent baslama xetasi:", err);
    agentStatus = "stopped";
  });

  agentProcess.on("exit", (code) => {
    console.log("Agent cixdi, kod:", code);
    agentProcess = null;
    agentStatus = "stopped";
  });
}

function stopAgent() {
  if (agentProcess) {
    console.log("Agent dayandirilir...");
    agentStatus = "stopping";
    const pid = agentProcess.pid;
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
          detached: true,
        });
      } else {
        agentProcess.kill("SIGTERM");
      }
    } catch (e) {
      console.error("Agent dayandirma xetasi:", e);
      agentStatus = "stopped";
    }
    agentProcess = null;
  }
}

function shouldAutoStartBackend() {
  let serverEnabled = true;
  let agentEnabled = true;

  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (saved.LIVEKIT_SERVER_ENABLED === false) {
        serverEnabled = false;
      }
      if (saved.AGENT_ENABLED === false) {
        agentEnabled = false;
      }
    }
  } catch (e) {}

  return { serverEnabled, agentEnabled };
}

function startBackendServices() {
  if (backendServicesStarted) {
    return { success: true, message: "Artiq basladilib" };
  }

  const { serverEnabled, agentEnabled } = shouldAutoStartBackend();

  if (serverEnabled) {
    startLiveKitServer();
  }

  if (agentEnabled) {
    startAgent();
  }

  backendServicesStarted = true;
  return { success: true };
}

function getSettingsPath() {
  if (!app.isPackaged) {
    return path.join(__dirname, "..", "setting.json");
  }
  return path.join(process.resourcesPath, "setting.json");
}

/**
 * Agent .env faylında belirli deyerleri yenileyir.
 * @param {Object} values - { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ... }
 */
function updateAgentEnv(values) {
  try {
    const agentDir = getAgentPath();
    const agentEnvPath = path.join(agentDir, ".env");
    
    // Agent klasörü yoksa oluştur
    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
    }
    
    let envContent = "";
    if (fs.existsSync(agentEnvPath)) {
      envContent = fs.readFileSync(agentEnvPath, "utf-8");
    }

    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    }

    const fd = fs.openSync(agentEnvPath, 'w');
    fs.writeSync(fd, envContent);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (e) {
    console.error("Agent .env update error:", e);
  }
}

/**
 * Main application .env / .env.local fayllarında belirli deyerleri yenileyir.
 * @param {Object} values - { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, ... }
 */
function updateMainEnv(values) {
  try {
    const envPaths = app.isPackaged
      ? [path.join(process.resourcesPath, ".env")]
      : [
          path.join(__dirname, "..", ".env.local"),
          path.join(__dirname, "..", ".env"),
        ];

    for (const envPath of envPaths) {
      let envContent = "";
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf-8");
      }

      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        const regex = new RegExp(`^${key}=.*$`, "m");
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`);
        } else {
          envContent += `\n${key}=${value}`;
        }
      }

      const fd = fs.openSync(envPath, 'w');
      fs.writeSync(fd, envContent);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    }
  } catch (e) {
    console.error("Main .env update error:", e);
  }
}

ipcMain.handle("app-update:check", async () => {
  if (!app.isPackaged) {
    return {
      updateAvailable: false,
      skipped: true,
      reason: "development",
      currentVersion: appPackage.version,
    };
  }

  try {
    const result = await checkForUpdate(appPackage.version, appPackage, {
      platform: process.platform,
      arch: process.arch,
    });
    pendingUpdateInfo = result.updateAvailable ? result : null;
    return result;
  } catch (error) {
    console.error("App update check failed:", error);
    return {
      updateAvailable: false,
      skipped: true,
      reason: "check_failed",
      error: error.message || String(error),
      currentVersion: appPackage.version,
    };
  }
});

ipcMain.handle("app-update:download", async (event) => {
  if (!pendingUpdateInfo?.downloadUrl) {
    return {
      success: false,
      error: "Yükləmə linki tapılmadı",
    };
  }

  try {
    const installerPath = await downloadUpdate(
      pendingUpdateInfo.downloadUrl,
      pendingUpdateInfo.assetName,
      (progress) => {
        event.sender.send("app-update:download-progress", progress);
      }
    );

    const openError = await shell.openPath(installerPath);
    if (openError) {
      throw new Error(openError);
    }

    setTimeout(() => {
      app.quit();
    }, 800);

    return { success: true, installerPath };
  } catch (error) {
    console.error("App update download failed:", error);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
});

ipcMain.handle("app:start-backend", () => startBackendServices());
ipcMain.handle("app:get-system-language", () => app.getLocale());

ipcMain.handle("settings:get", () => {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to read settings.json:", error);
  }
  return {
    LIVEKIT_URL: process.env.LIVEKIT_URL || "",
    LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY || "",
    LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET || "",
    LIVEKIT_AGENT_NAME: process.env.LIVEKIT_AGENT_NAME || "",
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || "",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
    AI_PROVIDER: process.env.AI_PROVIDER || "google",
    LIVEKIT_SERVER_ENABLED: true,
    AGENT_ENABLED: true,
    OVERLAY_ENABLED: true,
    AUTO_CONNECT_ENABLED: false,
    AGENT_LAUNCH_MODE: "start",
    AUTO_LAUNCH: app.getLoginItemSettings().openAtLogin,
  };
});

ipcMain.handle("settings:save", (_, settings) => {
  try {
    const settingsPath = getSettingsPath();
    
    // Dosya yoksa oluştur
    const settingsDir = path.dirname(settingsPath);
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }
    
    const fd = fs.openSync(settingsPath, 'w');
    fs.writeSync(fd, JSON.stringify(settings, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    
    // Auto-launch ayarini tetiqle
    if (settings.AUTO_LAUNCH !== undefined) {
      app.setLoginItemSettings({
        openAtLogin: settings.AUTO_LAUNCH,
        path: app.getPath("exe"),
      });
    }

    if (settings.LIVEKIT_URL !== undefined) process.env.LIVEKIT_URL = settings.LIVEKIT_URL;
    if (settings.LIVEKIT_API_KEY !== undefined) process.env.LIVEKIT_API_KEY = settings.LIVEKIT_API_KEY;
    if (settings.LIVEKIT_API_SECRET !== undefined) process.env.LIVEKIT_API_SECRET = settings.LIVEKIT_API_SECRET;
    if (settings.LIVEKIT_AGENT_NAME !== undefined) process.env.LIVEKIT_AGENT_NAME = settings.LIVEKIT_AGENT_NAME;
    if (settings.AI_PROVIDER !== undefined) process.env.AI_PROVIDER = settings.AI_PROVIDER;
    
    // Agent ve Main .env fayllarini yenile
    const envUpdates = {
      LIVEKIT_URL: settings.LIVEKIT_URL,
      LIVEKIT_API_KEY: settings.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: settings.LIVEKIT_API_SECRET,
      LIVEKIT_AGENT_NAME: settings.LIVEKIT_AGENT_NAME,
      GOOGLE_API_KEY: settings.GOOGLE_API_KEY,
      OPENAI_API_KEY: settings.OPENAI_API_KEY,
      AI_PROVIDER: settings.AI_PROVIDER,
    };
    
    updateAgentEnv(envUpdates);
    updateMainEnv(envUpdates);
    
    return { success: true };
  } catch (error) {
    console.error("Failed to save settings.json:", error);
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle("livekit:get-connection-details", () => {
  try {
    return getConnectionDetails();
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
});

ipcMain.handle("livekit-server:status", () => {
  const serverPath = getLiveKitServerPath();
  const exists = fs.existsSync(serverPath);
  return {
    running: livekitProcess !== null,
    status: livekitStatus,
    exeExists: exists,
    path: exists ? serverPath : null,
    version: exists ? getLiveKitInstalledVersion(serverPath) : null,
    managed: exists && serverPath === getManagedLiveKitServerPath(),
  };
});

ipcMain.handle("livekit-server:check-update", async () => {
  try {
    const serverPath = getLiveKitServerPath();
    const exists = fs.existsSync(serverPath);
    const currentVersion = exists ? getLiveKitInstalledVersion(serverPath) : null;

    if (process.platform === "darwin") {
      const info = await getLiveKitLatestReleaseInfo();
      return {
        hasUpdate: currentVersion && info.latestVersion
          ? compareSemver(info.latestVersion, currentVersion) > 0
          : false,
        current: currentVersion,
        latest: info.latestVersion,
        platform: process.platform,
        packageName: "livekit",
      };
    }

    const info = await getLiveKitLatestReleaseInfo();
    return {
      hasUpdate: currentVersion && info.latestVersion
        ? compareSemver(info.latestVersion, currentVersion) > 0
        : false,
      current: currentVersion,
      latest: info.latestVersion,
      assetName: info.assetName,
      releaseUrl: info.releaseUrl,
      platform: process.platform,
    };
  } catch (error) {
    return { hasUpdate: false, error: error.message || String(error) };
  }
});

ipcMain.handle("livekit-server:install", async () => {
  return installLiveKitFromRelease();
});

ipcMain.handle("livekit-server:upgrade", async () => {
  if (process.platform === "darwin") {
    const update = await runCommand("brew", ["update"]);
    if (!update.success) return update;
    return runCommand("brew", ["upgrade", "livekit"]);
  }
  return installLiveKitFromRelease();
});

ipcMain.handle("livekit-server:uninstall", async () => {
  if (livekitProcess) {
    return { success: false, error: "LiveKit server is running" };
  }

  if (process.platform === "darwin") {
    return runCommand("brew", ["uninstall", "livekit"]);
  }

  try {
    const managedDir = getManagedLiveKitDir();
    if (fs.existsSync(managedDir)) {
      fs.rmSync(managedDir, { recursive: true, force: true });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle("livekit-server:start", () => {
  if (livekitProcess) {
    return { success: true, message: "Artiq isleyir" };
  }

  // Save current LiveKit settings to DEFAULTS before switching to local defaults
  try {
    const settingsPath = getSettingsPath();
    let current = {};
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
    // Only save to DEFAULTS if not already saved (avoid overwriting real settings with local defaults)
    if (!current.DEFAULTS) {
      current.DEFAULTS = {
        LIVEKIT_URL: current.LIVEKIT_URL || "",
        LIVEKIT_API_KEY: current.LIVEKIT_API_KEY || "",
        LIVEKIT_API_SECRET: current.LIVEKIT_API_SECRET || "",
      };
    }

    // Apply local server defaults
    current.LIVEKIT_URL = "ws://localhost:7880";
    current.LIVEKIT_API_KEY = "devkey";
    current.LIVEKIT_API_SECRET = "secret";
    current.LIVEKIT_SERVER_ENABLED = true;
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), "utf-8");

    // Update process env
    process.env.LIVEKIT_URL = current.LIVEKIT_URL;
    process.env.LIVEKIT_API_KEY = current.LIVEKIT_API_KEY;
    process.env.LIVEKIT_API_SECRET = current.LIVEKIT_API_SECRET;

    // Update agent ve main .env with local defaults
    updateAgentEnv({
      LIVEKIT_URL: current.LIVEKIT_URL,
      LIVEKIT_API_KEY: current.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: current.LIVEKIT_API_SECRET,
    });
    updateMainEnv({
      LIVEKIT_URL: current.LIVEKIT_URL,
      LIVEKIT_API_KEY: current.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: current.LIVEKIT_API_SECRET,
    });
  } catch (e) {
    console.error("Server start settings error:", e);
  }

  startLiveKitServer();
  return { success: true, message: livekitProcess ? "Basladildi" : "Basladila bilmedi" };
});

ipcMain.handle("livekit-server:stop", () => {
  stopLiveKitServer();

  try {
    const settingsPath = getSettingsPath();
    let current = {};
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
    current.LIVEKIT_SERVER_ENABLED = false;

    // Restore from DEFAULTS saved in setting.json
    if (current.DEFAULTS) {
      current.LIVEKIT_URL = current.DEFAULTS.LIVEKIT_URL || "";
      current.LIVEKIT_API_KEY = current.DEFAULTS.LIVEKIT_API_KEY || "";
      current.LIVEKIT_API_SECRET = current.DEFAULTS.LIVEKIT_API_SECRET || "";
      delete current.DEFAULTS; // Clean up after restoring
    }

    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), "utf-8");

    // Update process env with restored values
    if (current.LIVEKIT_URL !== undefined) process.env.LIVEKIT_URL = current.LIVEKIT_URL;
    if (current.LIVEKIT_API_KEY !== undefined) process.env.LIVEKIT_API_KEY = current.LIVEKIT_API_KEY;
    if (current.LIVEKIT_API_SECRET !== undefined) process.env.LIVEKIT_API_SECRET = current.LIVEKIT_API_SECRET;

    // Update agent ve main .env with restored values
    updateAgentEnv({
      LIVEKIT_URL: current.LIVEKIT_URL,
      LIVEKIT_API_KEY: current.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: current.LIVEKIT_API_SECRET,
    });
    updateMainEnv({
      LIVEKIT_URL: current.LIVEKIT_URL,
      LIVEKIT_API_KEY: current.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: current.LIVEKIT_API_SECRET,
    });
  } catch (e) {
    console.error("Server stop settings error:", e);
  }
  return { success: true, message: "Dayandirildi" };
});

ipcMain.handle("agent:check-exe", () => {
  const agentDir = getAgentPath();
  const azeraiExe = path.join(agentDir, "venv", "Scripts", "azerai.exe");
  return fs.existsSync(azeraiExe);
});

ipcMain.handle("agent:check-update", async () => {
  const agentDir = getAgentPath();
  const pythonExe = path.join(agentDir, "venv", "Scripts", "python.exe");
  
  if (!fs.existsSync(pythonExe)) return { hasUpdate: false, packages: [] };

  return new Promise((resolve) => {
    const checkProcess = spawn(pythonExe, ["-m", "pip", "list", "--outdated", "--format=json", "--disable-pip-version-check"], {
      cwd: agentDir,
      windowsHide: true,
    });

    let output = "";
    checkProcess.stdout.on("data", (data) => { output += data.toString(); });
    
    checkProcess.on("close", (code) => {
      try {
        const allPackages = JSON.parse(output);
        // Filter only azerai and azerai-* packages
        const azeraiPackages = Array.isArray(allPackages)
          ? allPackages.filter(pkg => pkg.name && pkg.name.toLowerCase().startsWith("azerai"))
          : [];
        resolve({
          hasUpdate: azeraiPackages.length > 0,
          packages: azeraiPackages.map(pkg => ({
            name: pkg.name,
            current: pkg.version || "",
            latest: pkg.latest_version || "",
          })),
        });
      } catch (e) {
        console.error("pip outdated parse error:", e);
        resolve({ hasUpdate: false, packages: [] });
      }
    });

    checkProcess.on("error", () => resolve({ hasUpdate: false, packages: [] }));
  });
});

ipcMain.handle("agent:upgrade", async (_, packageNames) => {
  const agentDir = getAgentPath();
  const pythonExe = process.platform === "win32"
    ? path.join(agentDir, "venv", "Scripts", "python.exe")
    : path.join(agentDir, "venv", "bin", "python");

  if (!fs.existsSync(pythonExe)) return { success: false, error: "Python tapilmadi" };

  // Accept array of package names, or default to ["azerai"]
  const targets = Array.isArray(packageNames) && packageNames.length > 0
    ? packageNames
    : ["azerai"];

  return new Promise((resolve) => {
    console.log("AzerAI yenilenir:", targets.join(", "));
    const args = ["-m", "pip", "install", "--upgrade", ...targets];
    const upgradeProcess = spawn(pythonExe, args, {
      cwd: agentDir,
      windowsHide: true,
    });

    let stderr = "";
    upgradeProcess.stderr.on("data", (d) => { stderr += d.toString(); });

    upgradeProcess.on("close", (code) => {
      if (code === 0) {
        console.log("AzerAI ugurla yenilendi.");
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr.slice(-300) || `Yenilenme xetasi (Kod: ${code})` });
      }
    });

    upgradeProcess.on("error", (err) => resolve({ success: false, error: err.message }));
  });
});

// ── Python / venv / azerai helpers ──────────────────────────────────

/**
 * Sistemde Python yüklü olub-olmadığını yoxlayır.
 * Windows, Linux ve macOS için platforma özgü yolları sınayır.
 */
function findSystemPython() {
  let candidates = [];

  if (process.platform === "win32") {
    candidates = [
      "python",
      "python3",
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python313", "python.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python311", "python.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python310", "python.exe"),
    ];
  } else if (process.platform === "darwin") {
    candidates = [
      "python3",
      "python",
      "/opt/homebrew/bin/python3",
      "/usr/local/bin/python3",
      "/usr/bin/python3",
    ];
  } else {
    // Linux
    candidates = [
      "python3",
      "python",
      "/usr/bin/python3",
      "/usr/bin/python",
      "/usr/local/bin/python3",
      "/usr/local/bin/python",
    ];
  }

  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ["--version"], {
        windowsHide: true,
        timeout: 5000,
      });
      if (result.status === 0) return cmd;
    } catch (_) {
      // bu adrestə yoxdur, davam et
    }
  }
  return null;
}



/**
 * Python yüklü deyilsə, silentsiz install edir.
 * Windows, Linux ve macOS için platforma özgü paket yöneticileri kullanır.
 * @returns {Promise<{success:boolean, pythonCmd?:string, error?:string}>}
 */
function installPython() {
  return new Promise((resolve) => {
    console.log("Python tapilmadi, qurasdirilir...");

    if (process.platform === "win32") {
      // Windows: winget veya python.org
      const wingetProcess = spawn(
        "winget",
        ["install", "Python.Python.3.12", "--accept-package-agreements", "--accept-source-agreements", "--silent"],
        { windowsHide: true, shell: true }
      );

      wingetProcess.on("close", (code) => {
        if (code === 0) {
          const pythonCmd = findSystemPython();
          if (pythonCmd) {
            resolve({ success: true, pythonCmd });
          } else {
            const fallback = path.join(
              process.env.LOCALAPPDATA || "",
              "Programs", "Python", "Python312", "python.exe"
            );
            if (fs.existsSync(fallback)) {
              resolve({ success: true, pythonCmd: fallback });
            } else {
              resolve({ success: false, error: "Python qurasdirildi amma tapilmadi. Zehmet olmasa app-i yeniden basladın." });
            }
          }
        } else {
          downloadAndInstallPython()
            .then(resolve)
            .catch((err) => resolve({ success: false, error: err.message }));
        }
      });

      wingetProcess.on("error", () => {
        downloadAndInstallPython()
          .then(resolve)
          .catch((err) => resolve({ success: false, error: err.message }));
      });
    } else if (process.platform === "darwin") {
      // macOS: Homebrew ile python3 kurulumu
      const brewProcess = spawn("brew", ["install", "python"], { windowsHide: true });

      brewProcess.on("close", (code) => {
        if (code === 0) {
          const pythonCmd = findSystemPython();
          if (pythonCmd) {
            resolve({ success: true, pythonCmd });
          } else {
            resolve({ success: false, error: "Python qurasdirildi amma tapilmadi. Zehmet olmasa app-i yeniden basladın." });
          }
        } else {
          resolve({ success: false, error: "Homebrew ile Python qurasdirilma xetasi (Kod: ${code}). Homebrew yuklu oldugundan emin olun." });
        }
      });

      brewProcess.on("error", (err) => {
        resolve({ success: false, error: "Homebrew tapilmadi. Zehmet olmasa Homebrew qurasdirin: https://brew.sh" });
      });
    } else {
      // Linux: apt/yum/dnf ile python3 kurulumu
      const packageManager = detectLinuxPackageManager();
      if (!packageManager) {
        resolve({ success: false, error: "Desteklenen paket yöneticisi tapilmadi (apt, yum, dnf). Pythonu manuel qurasdirin." });
        return;
      }

      const installCmd = packageManager === "apt"
        ? ["sudo", "apt", "install", "-y", "python3", "python3-pip", "python3-venv"]
        : packageManager === "yum"
        ? ["sudo", "yum", "install", "-y", "python3", "python3-pip"]
        : ["sudo", "dnf", "install", "-y", "python3", "python3-pip", "python3-venv"];

      const installProcess = spawn(installCmd[0], installCmd.slice(1), { windowsHide: true, shell: true });

      installProcess.on("close", (code) => {
        if (code === 0) {
          const pythonCmd = findSystemPython();
          if (pythonCmd) {
            resolve({ success: true, pythonCmd });
          } else {
            resolve({ success: false, error: "Python qurasdirildi amma tapilmadi. Zehmet olmasa app-i yeniden basladın." });
          }
        } else {
          resolve({ success: false, error: "Python qurasdirilma xetasi (Kod: ${code}). Sudo icazeleri oldugundan emin olun." });
        }
      });

      installProcess.on("error", (err) => {
        resolve({ success: false, error: `Paket yöneticisi xetasi: ${err.message}` });
      });
    }
  });
}

/**
 * Linux paket yöneticisini tespit eder (apt, yum, dnf)
 */
function detectLinuxPackageManager() {
  try {
    if (fs.existsSync("/usr/bin/apt")) return "apt";
    if (fs.existsSync("/usr/bin/yum")) return "yum";
    if (fs.existsSync("/usr/bin/dnf")) return "dnf";
  } catch (_) {}
  return null;
}

/**
 * python.org-dan installer yükləyib silentsiz quraşdırır.
 */
function downloadAndInstallPython() {
  return new Promise((resolve, reject) => {
    const https = require("https");
    const installerUrl =
      "https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe";
    const installerPath = path.join(app.getPath("temp"), "python-installer.exe");

    console.log("Python installer yuklenir...", installerUrl);
    const file = fs.createWriteStream(installerPath);

    https
      .get(installerUrl, (res) => {
        res.pipe(file);
        file.on("finish", () => {
          file.close(() => {
            console.log("Python installer qurasdirilir...");
            const installerProcess = spawn(
              installerPath,
              ["/quiet", "InstallAllUsers=0", "PrependPath=1", "Include_pip=1"],
              { windowsHide: true }
            );

            installerProcess.on("close", (code) => {
              // Müvəqqəti faylı sil
              try { fs.unlinkSync(installerPath); } catch (_) {}

              if (code === 0) {
                const pythonCmd = findSystemPython();
                if (pythonCmd) {
                  resolve({ success: true, pythonCmd });
                } else {
                  const fallback = path.join(
                    process.env.LOCALAPPDATA || "",
                    "Programs", "Python", "Python312", "python.exe"
                  );
                  resolve(
                    fs.existsSync(fallback)
                      ? { success: true, pythonCmd: fallback }
                      : { success: false, error: "Python qurasdirildi amma tapilmadi. Zehmet olmasa app-i yeniden basladın." }
                  );
                }
              } else {
                resolve({ success: false, error: `Python qurasdirilma xetasi (Kod: ${code})` });
              }
            });

            installerProcess.on("error", (err) =>
              resolve({ success: false, error: err.message })
            );
          });
        });
      })
      .on("error", (err) => {
        try { fs.unlinkSync(installerPath); } catch (_) {}
        reject(err);
      });
  });
}

/**
 * Agent qovluğunda venv yaradır.
 * @param {string} pythonCmd - sistem Python-u (məs: "python" və ya tam yol)
 * @returns {Promise<{success:boolean, error?:string}>}
 */
function createVenv(pythonCmd) {
  return new Promise((resolve) => {
    const agentDir = getAgentPath();
    const venvPath = path.join(agentDir, "venv");

    // Əgər venv artıq varsa və python varsa, skip et (Windows: Scripts/python.exe, Linux/macOS: bin/python)
    const existingPython = process.platform === "win32"
      ? path.join(venvPath, "Scripts", "python.exe")
      : path.join(venvPath, "bin", "python");

    if (fs.existsSync(existingPython)) {
      console.log("venv artiq movcuddur:", venvPath);
      resolve({ success: true });
      return;
    }

    console.log("venv yaradilir:", pythonCmd, venvPath);
    const venvProcess = spawn(pythonCmd, ["-m", "venv", venvPath], {
      windowsHide: true,
    });

    venvProcess.on("close", (code) => {
      if (code === 0) {
        console.log("venv ugurla yaradildi.");
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `venv yaratma xetasi (Kod: ${code})` });
      }
    });

    venvProcess.on("error", (err) =>
      resolve({ success: false, error: err.message })
    );
  });
}

/**
 * venv-dəki Python ilə azerai paketini quraşdırır.
 * @returns {Promise<{success:boolean, error?:string}>}
 */
function installAzerai() {
  return new Promise((resolve) => {
    const agentDir = getAgentPath();
    const pythonExe = process.platform === "win32"
      ? path.join(agentDir, "venv", "Scripts", "python.exe")
      : path.join(agentDir, "venv", "bin", "python");

    if (!fs.existsSync(pythonExe)) {
      return resolve({ success: false, error: "venv Python tapilmadi" });
    }

    console.log("AzerAI qurasdirilir (venv)...");
    const installProcess = spawn(
      pythonExe,
      ["-m", "pip", "install", "azerai"],
      { cwd: agentDir, windowsHide: true }
    );

    installProcess.on("close", (code) => {
      if (code === 0) {
        console.log("AzerAI ugurla qurasdirildi.");
        resolve({ success: true });
      } else {
        console.error("AzerAI qurasdirilma xetasi, kod:", code);
        resolve({ success: false, error: `Qurasdirilma xetasi (Kod: ${code})` });
      }
    });

    installProcess.on("error", (err) => {
      console.error("Spawn xetasi:", err);
      resolve({ success: false, error: err.message });
    });
  });
}

// ── IPC Handlers ───────────────────────────────────────────────────

ipcMain.handle("agent:check-python", () => {
  const pythonCmd = findSystemPython();
  return { installed: !!pythonCmd, pythonCmd: pythonCmd || null };
});

ipcMain.handle("agent:install-python", async () => {
  return installPython();
});

ipcMain.handle("agent:create-venv", async () => {
  const pythonCmd = findSystemPython();
  if (!pythonCmd) {
    return { success: false, error: "Python tapilmadi. Evvelce Python-u qurasdirin." };
  }
  return createVenv(pythonCmd);
});

ipcMain.handle("agent:install", async () => {
  // Addım 1: Python yoxla
  let pythonCmd = findSystemPython();
  if (!pythonCmd) {
    // Python yoxdur, qurasdir
    const pyResult = await installPython();
    if (!pyResult.success) return pyResult;
    pythonCmd = pyResult.pythonCmd;
  }

  // Addım 2: venv yoxla / yarat
  const venvResult = await createVenv(pythonCmd);
  if (!venvResult.success) return venvResult;

  // Addım 3: azerai qurasdir
  return installAzerai();
});

ipcMain.handle("agent:uninstall", async () => {
  const agentDir = getAgentPath();
  const pythonExe = process.platform === "win32"
    ? path.join(agentDir, "venv", "Scripts", "python.exe")
    : path.join(agentDir, "venv", "bin", "python");

  if (!fs.existsSync(pythonExe)) return { success: false, error: "Python tapilmadi" };

  return new Promise((resolve) => {
    console.log("AzerAI silinir...");
    const uninstallProcess = spawn(pythonExe, ["-m", "pip", "uninstall", "-y", "azerai"], {
      cwd: agentDir,
      windowsHide: true,
    });

    uninstallProcess.on("close", (code) => {
      if (code === 0) {
        console.log("AzerAI ugurla silindi.");
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `Silinme xetasi (Kod: ${code})` });
      }
    });

    uninstallProcess.on("error", (err) => resolve({ success: false, error: err.message }));
  });
});

ipcMain.handle("agent:clear-history", async () => {
  try {
    const agentDir = getAgentPath();
    const historyPath = path.join(agentDir, "azerai_history.json");
    
    if (fs.existsSync(historyPath)) {
      fs.unlinkSync(historyPath);
      return { success: true };
    } else {
      return { success: true, message: "Tarixçe onsuz da boşdur" };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("agent:check-history", async () => {
  try {
    const agentDir = getAgentPath();
    const historyPath = path.join(agentDir, "azerai_history.json");
    return fs.existsSync(historyPath);
  } catch (err) {
    return false;
  }
});

// ====== PLUGIN MANAGEMENT ======

ipcMain.handle("plugin:list", async () => {
  const agentDir = getAgentPath();
  const pythonExe = process.platform === "win32"
    ? path.join(agentDir, "venv", "Scripts", "python.exe")
    : path.join(agentDir, "venv", "bin", "python");
  const pluginsDir = path.join(agentDir, "plugins");

  const result = { pip: [], local: [] };

  // List local plugins (folders in agent/plugins/)
  try {
    if (fs.existsSync(pluginsDir)) {
      result.local = fs.readdirSync(pluginsDir).filter(name => {
        const fp = path.join(pluginsDir, name);
        return fs.statSync(fp).isDirectory();
      });
    }
  } catch (e) {
    console.error("Local plugin list error:", e);
  }

  // List pip packages (only azerai-* plugins)
  if (fs.existsSync(pythonExe)) {
    try {
      const output = spawnSync(pythonExe, ["-m", "pip", "list", "--format=columns", "--disable-pip-version-check"], {
        cwd: agentDir,
        windowsHide: true,
        timeout: 15000,
        encoding: "utf-8",
      });
      if (output.status === 0 && output.stdout) {
        const lines = output.stdout.split("\n").slice(2).filter(l => l.trim());
        result.pip = lines.map(line => {
          const parts = line.trim().split(/\s{2,}/);
          return { name: parts[0], version: parts[1] || "" };
        }).filter(p => p.name.toLowerCase().startsWith("azerai-"));
      }
    } catch (e) {
      console.error("Pip plugin list error:", e);
    }
  }

  return result;
});

ipcMain.handle("plugin:install-pip", async (_, packageName) => {
  const agentDir = getAgentPath();
  const pythonExe = process.platform === "win32"
    ? path.join(agentDir, "venv", "Scripts", "python.exe")
    : path.join(agentDir, "venv", "bin", "python");
  if (!fs.existsSync(pythonExe)) return { success: false, error: "Python tapılmadı" };
  if (!packageName || !packageName.trim()) return { success: false, error: "Paket adı boş ola bilməz" };

  return new Promise((resolve) => {
    console.log(`Plugin pip install: ${packageName}`);
    const proc = spawn(pythonExe, ["-m", "pip", "install", packageName.trim(), "--disable-pip-version-check"], {
      cwd: agentDir,
      windowsHide: true,
    });

    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve({ success: true });
      else resolve({ success: false, error: stderr.slice(-300) || `Xəta (Kod: ${code})` });
    });
    proc.on("error", (err) => resolve({ success: false, error: err.message }));
  });
});

ipcMain.handle("plugin:uninstall-pip", async (_, packageName) => {
  const agentDir = getAgentPath();
  const pythonExe = process.platform === "win32"
    ? path.join(agentDir, "venv", "Scripts", "python.exe")
    : path.join(agentDir, "venv", "bin", "python");
  if (!fs.existsSync(pythonExe)) return { success: false, error: "Python tapılmadı" };

  return new Promise((resolve) => {
    console.log(`Plugin pip uninstall: ${packageName}`);
    const proc = spawn(pythonExe, ["-m", "pip", "uninstall", "-y", packageName], {
      cwd: agentDir,
      windowsHide: true,
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ success: true });
      else resolve({ success: false, error: `Xəta (Kod: ${code})` });
    });
    proc.on("error", (err) => resolve({ success: false, error: err.message }));
  });
});

ipcMain.handle("plugin:install-local", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Plugin ZIP faylını seçin",
    filters: [{ name: "ZIP fayllar", extensions: ["zip"] }],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return { success: false, canceled: true };

  const zipPath = filePaths[0];
  const agentDir = getAgentPath();
  const pluginsDir = path.join(agentDir, "plugins");

  try {
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
    }

    // Extract ZIP using PowerShell (Windows) or tar (Linux/macOS)
    return new Promise((resolve) => {
      let proc;
      if (process.platform === "win32") {
        proc = spawn(
          "powershell.exe",
          ["-NoProfile", "-Command",
            `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${pluginsDir.replace(/'/g, "''")}' -Force`
          ],
          { windowsHide: true }
        );
      } else {
        proc = spawn("tar", ["-xf", zipPath, "-C", pluginsDir], { windowsHide: true });
      }
      let stderr = "";
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) resolve({ success: true, path: pluginsDir });
        else resolve({ success: false, error: stderr.slice(-300) || `Xəta (Kod: ${code})` });
      });
      proc.on("error", (err) => resolve({ success: false, error: err.message }));
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("plugin:uninstall-local", async (_, pluginName) => {
  const agentDir = getAgentPath();
  const pluginDir = path.join(agentDir, "plugins", pluginName);

  try {
    if (!fs.existsSync(pluginDir)) return { success: false, error: "Plugin tapılmadı" };
    fs.rmSync(pluginDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ====== END PLUGIN MANAGEMENT ======

ipcMain.handle("agent:status", () => {
  const agentDir = getAgentPath();
  const azeraiExe = path.join(agentDir, "venv", "Scripts", "azerai.exe");
  const exists = fs.existsSync(azeraiExe);
  return { running: agentProcess !== null, status: agentStatus, exeExists: exists };
});

ipcMain.handle("agent:start", () => {
  if (agentProcess) {
    return { success: true, message: "Agent artiq isleyir" };
  }
  startAgent();
  try {
    const settingsPath = getSettingsPath();
    let current = {};
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
    current.AGENT_ENABLED = true;
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), "utf-8");
  } catch (e) {
    console.error("Agent ayar saxlama xetasi:", e);
  }
  return { success: true, message: agentProcess ? "Agent basladildi" : "Agent basladila bilmedi" };
});

ipcMain.handle("agent:stop", () => {
  stopAgent();
  try {
    const settingsPath = getSettingsPath();
    let current = {};
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
    current.AGENT_ENABLED = false;
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), "utf-8");
  } catch (e) {
    console.error("Agent ayar saxlama xetasi:", e);
  }
  return { success: true, message: "Agent dayandirildi" };
});

function isDevServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(DEV_SERVER_URL, (res) => {
      res.resume();
      resolve(true);
    });

    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function getUiFile() {
  return path.join(__dirname, "..", "dist", "renderer", "index.html");
}

async function resolveUiTarget() {
  if (!app.isPackaged && (await isDevServerRunning())) {
    return { type: "url", target: DEV_SERVER_URL };
  }

  const uiFile = getUiFile();
  if (fs.existsSync(uiFile)) {
    return { type: "file", target: uiFile };
  }

  throw new Error(
    "UI not found. Run: npm run build:ui   (or for hot reload: npm run desktop)"
  );
}

async function createWindow() {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (
        permission === "media" ||
        permission === "camera" ||
        permission === "microphone" ||
        permission === "display-capture"
      ) {
        callback(true);
      } else {
        callback(false);
      }
    }
  );

  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 150, height: 150 },
          fetchWindowIcons: true,
        });

        if (!sources || sources.length === 0) {
          callback({});
          return;
        }

        // Serialize sources for picker
        const sourcesData = sources.map(source => ({
          id: source.id,
          name: source.name,
          thumbnail: source.thumbnail?.toDataURL(),
          appIcon: source.appIcon?.toDataURL(),
          display_id: source.display_id,
        }));

        // Show picker and wait for user selection
        const selectedId = await showSourcePicker(sourcesData);
        
        if (!selectedId) {
          callback({}); // User cancelled
          return;
        }

        const selectedSource = sources.find(s => s.id === selectedId);
        if (!selectedSource) {
          callback({});
          return;
        }

        callback({
          video: selectedSource,
          audio:
            process.platform === "win32" && request.audioRequested
              ? "loopback"
              : undefined,
        });
      } catch (error) {
        console.error("Failed to grant display media request:", error);
        callback({});
      }
    }
  );

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: `AzerAI App v${appPackage.version}`,
    icon: path.join(__dirname, "..", "public", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;

  console.log(`Window title set to: AzerAI App v${appPackage.version}`);
  
  // Also set title after window is created to ensure it sticks
  win.setTitle(`AzerAI App v${appPackage.version}`);

  // Prevent web page from changing the title
  win.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  // Completely hide menu bar
  win.setMenuBarVisibility(false);

  const ui = await resolveUiTarget();
  if (ui.type === "url") {
    await win.loadURL(ui.target);
  } else {
    await win.loadFile(ui.target);
  }

  // Destroy overlay windows when main window closes
  win.on("closed", () => {
    if (azeraiWindow && !azeraiWindow.isDestroyed()) {
      azeraiWindow.destroy();
      azeraiWindow = null;
    }
    if (captionWindow && !captionWindow.isDestroyed()) {
      captionWindow.destroy();
      captionWindow = null;
    }
  });
}

app.whenReady().then(() => {
  // Remove menu bar completely
  Menu.setApplicationMenu(null);
  
  createWindow();
  createAzeraiOverlay();
  createCaptionOverlay();
}).catch((error) => {
  console.error(error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  stopAgent();
  stopLiveKitServer();
  // Taskkill-in tamamlanmasi ucun bir az gozle
  setTimeout(() => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  }, 500);
});

app.on("before-quit", (e) => {
  // Always clean up overlay windows first
  if (azeraiWindow && !azeraiWindow.isDestroyed()) {
    azeraiWindow.destroy();
    azeraiWindow = null;
  }
  if (captionWindow && !captionWindow.isDestroyed()) {
    captionWindow.destroy();
    captionWindow = null;
  }
  
  if (agentProcess || livekitProcess) {
    stopAgent();
    stopLiveKitServer();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => {
      console.error(error.message);
      app.quit();
    });
  }
});
