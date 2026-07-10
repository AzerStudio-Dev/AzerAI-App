const { AccessToken, RoomServiceClient } = require("livekit-server-sdk");
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

  const agentNames =
    options?.room_config?.agents?.map(a => a.agent_name) ||
    settings.LIVEKIT_AGENT_NAMES ||
    (process.env.LIVEKIT_AGENT_NAMES ? process.env.LIVEKIT_AGENT_NAMES.split(',').map(n => n.trim()).filter(n => n) : null);
  const participantName = settings.LIVEKIT_PARTICIPANT_NAME || "user";
  const participantIdentity = settings.LIVEKIT_PARTICIPANT_IDENTITY || `user_${Math.floor(Math.random() * 10000)}`;
  const roomName = settings.LIVEKIT_ROOM_NAME || process.env.LIVEKIT_ROOM_NAME || "AzerAI_Home";

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantName,
    ttl: "7d",
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    emptyTimeout: 600,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  if (agentNames && agentNames.length > 0) {
    at.roomConfig = new RoomConfiguration({
      agents: agentNames.map(agentName => ({ agentName })),
    });
  }

  let roomExists = false;
  try {
    const svc = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
    const rooms = await svc.listRooms([roomName]);
    roomExists = rooms.some(r => r.name === roomName);
  } catch (e) {
    console.error("Failed to check room existence:", e);
  }

  return {
    serverUrl: livekitUrl,
    roomName,
    roomExists,
    participantName,
    participantToken: await at.toJwt(),
  };
}

module.exports = { getConnectionDetails };
