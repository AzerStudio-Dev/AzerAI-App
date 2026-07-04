const { AccessToken } = require("livekit-server-sdk");
const { RoomConfiguration } = require("@livekit/protocol");
const fs = require("fs");
const path = require("path");

function getSettingsPath() {
  try {
    const { app } = require("electron");
    if (app) {
      if (!app.isPackaged) {
        return path.join(app.getAppPath(), "setting.json");
      }
      return path.join(app.getPath("userData"), "setting.json");
    }
  } catch (e) {}
  return path.join(__dirname, "..", "setting.json");
}

async function getConnectionDetails(options = {}) {
  let settings = {};
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
  } catch (error) {
    console.error("Failed to read setting.json in getConnectionDetails:", error);
  }

  const apiKey = settings.LIVEKIT_API_KEY || process.env.LIVEKIT_API_KEY;
  const apiSecret = settings.LIVEKIT_API_SECRET || process.env.LIVEKIT_API_SECRET;
  const livekitUrl = settings.LIVEKIT_URL || process.env.LIVEKIT_URL;

  if (!livekitUrl) throw new Error("LIVEKIT_URL missing");
  if (!apiKey) throw new Error("LIVEKIT_API_KEY missing");
  if (!apiSecret) throw new Error("LIVEKIT_API_SECRET missing");

  const agentName =
    options?.room_config?.agents?.[0]?.agent_name ||
    settings.LIVEKIT_AGENT_NAME ||
    process.env.LIVEKIT_AGENT_NAME;
  const participantName = "user";
  const participantIdentity = `user_${Math.floor(Math.random() * 10000)}`;
  const roomName = `room_${Math.floor(Math.random() * 10000)}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantName,
    ttl: "15m",
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  if (agentName) {
    at.roomConfig = new RoomConfiguration({
      agents: [{ agentName }],
    });
  }

  return {
    serverUrl: livekitUrl,
    roomName,
    participantName,
    participantToken: await at.toJwt(),
  };
}

module.exports = { getConnectionDetails };
