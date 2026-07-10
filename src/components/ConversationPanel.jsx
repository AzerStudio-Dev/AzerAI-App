import {
  useLocalParticipant,
  useParticipants,
  useChat,
  useTranscriptions,
  useVoiceAssistant,
  useRoomContext,
} from "@livekit/components-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentSession } from "@livekit/protocol";
import "./ConversationPanel.css";
import { useLanguage } from "../LanguageContext";

function isFinalStream(streamInfo) {
  return streamInfo?.attributes?.["lk.transcription_final"] === "true";
}

function formatDateTime(timestamp) {
  if (!timestamp) return "";
  let ms = timestamp;
  // If timestamp is in seconds, convert to milliseconds
  if (timestamp < 10000000000) {
    ms = timestamp * 1000;
  }
  const date = new Date(ms);
  
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

export default function ConversationPanel({ disabledByMiniAzer = false }) {
  const { t } = useLanguage();
  const { localParticipant } = useLocalParticipant();
  const { agent, state: agentState } = useVoiceAssistant();
  const participants = useParticipants();
  const transcriptions = useTranscriptions();
  const listRef = useRef(null);
  const [draft, setDraft] = useState("");

  const room = useRoomContext();
  const [activeTool, setActiveTool] = useState(null);
  const [backgroundTool, setBackgroundTool] = useState(null);
  const [backgroundToolCompleted, setBackgroundToolCompleted] = useState(null);
  const [toolCalls, setToolCalls] = useState([]);
  const toolTimeoutRef = useRef(null);
  const bgToolTimeoutRef = useRef(null);

  // ====== Mini AzerAI Overlay Integration ======
  // Update overlay based on agent state (agentState is a STRING: "listening", "thinking", "speaking", etc.)
  useEffect(() => {
    if (!window.livekit?.azeraiUpdateState) return;

    const isSpeaking = agentState === "speaking";
    const isThinking = agentState === "thinking";
    const isListening = agentState === "listening";

    // Get audio level from agent participant for wave animation
    const agentAudioLevel = agent?.audioLevel || 0;

    const overlayState = {
      connected: true,
      speaking: isSpeaking,
      thinking: isThinking,
      listening: isListening,
      audioLevel: isSpeaking ? Math.min(1, agentAudioLevel * 5) : 0,
      agentState: agentState || 'connecting', // Send actual agent state
      tool: false,
      toolName: '',
      backgroundTool: backgroundTool || null,
      backgroundToolCompleted: backgroundToolCompleted || null,
    };

    // Only show tool state when agent is NOT speaking (tool is processing, not just recently fired)
    if ((activeTool || backgroundTool) && !isSpeaking) {
      overlayState.tool = true;
      overlayState.toolName = activeTool || backgroundTool;
      overlayState.thinking = false;
      overlayState.listening = false;
      overlayState.backgroundTool = backgroundTool || null;
    }

    // Show completed status when background tool just finished
    if (backgroundToolCompleted && !isSpeaking) {
      overlayState.tool = true;
      overlayState.toolName = backgroundToolCompleted;
      overlayState.backgroundToolCompleted = backgroundToolCompleted;
    }

    window.livekit.azeraiUpdateState(overlayState).catch(err => {
      console.warn("Overlay state update failed:", err);
    });
  }, [agentState, activeTool, backgroundTool, backgroundToolCompleted, agent?.audioLevel]);

  // Send transcription updates to caption overlay (with dedup to avoid spam)
  const lastSentRef = useRef(new Map()); // streamId -> last sent text

  useEffect(() => {
    if (!window.livekit?.captionSend) return;
    if (!localParticipant?.identity) return;

    const localId = localParticipant.identity;
    const agentIdentities = new Set();
    if (agent?.identity) agentIdentities.add(agent.identity);
    for (const p of participants) {
      if (p.isAgent) agentIdentities.add(p.identity);
    }

    for (const item of transcriptions) {
      const text = item.text?.trim();
      if (!text) continue;
      const { identity } = item.participantInfo;
      const isUser = identity === localId;
      const isAgent = agentIdentities.has(identity);
      const isFinal = item.streamInfo?.attributes?.["lk.transcription_final"] === "true";

      if (isUser || isAgent) {
        // Dedup: skip if same text already sent for this stream+state
        const streamId = item.streamInfo?.id;
        const key = `${streamId}_${isFinal ? "final" : "live"}`;
        const lastText = lastSentRef.current.get(key);
        if (lastText === text) continue;
        lastSentRef.current.set(key, text);

        // Clean up old entries
        if (lastSentRef.current.size > 100) {
          const keys = Array.from(lastSentRef.current.keys());
          for (let i = 0; i < keys.length - 40; i++) {
            lastSentRef.current.delete(keys[i]);
          }
        }

        window.livekit.captionSend({
          role: isUser ? "user" : "agent",
          text,
          isFinal,
        }).catch(err => {
          console.warn("Caption send failed:", err);
        });
      }
    }
  }, [transcriptions, localParticipant?.identity, agent?.identity, participants]);
  // ====== End Mini AzerAI Overlay Integration ======

  useEffect(() => {
    if (!room) return;

    const TOPIC_SESSION_MESSAGES = "lk.agent.session";

    const onDataReceived = (payload, participant) => {
      try {
        const strData = new TextDecoder().decode(payload);
        const data = JSON.parse(strData);
        console.log("📡 Data received in ConversationPanel:", data);
        
        if (data.type === "background_tool") {
          console.log("⚙️ Background tool event:", data.status, data.tool);
          if (data.status === "running") {
            setBackgroundTool(data.tool);
            if (bgToolTimeoutRef.current) clearTimeout(bgToolTimeoutRef.current);
            
            // Otomatik temizleme (fallback)
            bgToolTimeoutRef.current = setTimeout(() => {
              setBackgroundTool(null);
            }, 10000);

            // Log ekle
            const newToolCall = {
              id: `bg_tool_${Date.now()}`,
              text: `⚙️ Arka planda çalışıyor: ${data.tool} (${data.title || ''})`,
              timestamp: Date.now(),
              role: "tool",
              source: "tool",
            };
            
            setToolCalls(prev => [...prev, newToolCall]);
            console.log("📝 Added background tool call to state:", newToolCall);
          } else if (data.status === "completed") {
            setBackgroundTool(null);
            setBackgroundToolCompleted(data.tool);
            if (bgToolTimeoutRef.current) clearTimeout(bgToolTimeoutRef.current);

            // Tamamlandı logu ekle
            setToolCalls(prev => [
              ...prev,
              {
                id: `bg_tool_complete_${Date.now()}`,
                text: `✅ Arka plan işlemi tamamlandı: ${data.tool} (${data.title || ''})`,
                timestamp: Date.now(),
                role: "tool",
                source: "tool",
              }
            ]);
            console.log("✅ Added background tool completion to state");

            // 2 saniye sonra tamamlandı status'unu temizle
            setTimeout(() => {
              setBackgroundToolCompleted(null);
            }, 2000);
          }
        }
      } catch (e) {
        // Not JSON or other error
      }
    };

    const onByteStream = async (reader, _participantInfo) => {
      try {
        const chunks = await reader.readAll();
        let totalLen = 0;
        for (const c of chunks) totalLen += c.byteLength;
        const data = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
          data.set(c, offset);
          offset += c.byteLength;
        }

        const msg = AgentSession.AgentSessionMessage.fromBinary(data);
        if (msg.message.case === "event") {
          const event = msg.message.value;
          if (event.event.case === "functionToolsExecuted") {
            const funcCalls = event.event.value.functionCalls || [];
            if (funcCalls.length > 0) {
              const toolNames = funcCalls.map(f => f.name);
              const toolName = toolNames[0];

              // Update active tool status
              setActiveTool(toolName);
              if (toolTimeoutRef.current) {
                clearTimeout(toolTimeoutRef.current);
              }
              toolTimeoutRef.current = setTimeout(() => {
                setActiveTool(null);
              }, 4000);

              // Add tool log to chat stream
              setToolCalls(prev => [
                ...prev,
                {
                  id: `tool_${Date.now()}_${Math.random()}`,
                  text: `${t("toolLog")} ${toolNames.join(", ")}`,
                  timestamp: Date.now(),
                  role: "tool",
                  source: "tool",
                }
              ]);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to parse byte stream message inside ConversationPanel:", e);
      }
    };

    try {
      room.registerByteStreamHandler(TOPIC_SESSION_MESSAGES, onByteStream);
      room.on("dataReceived", onDataReceived);
    } catch (e) {
      console.warn("Failed to register handlers inside ConversationPanel:", e);
    }

    return () => {
      if (toolTimeoutRef.current) clearTimeout(toolTimeoutRef.current);
      if (bgToolTimeoutRef.current) clearTimeout(bgToolTimeoutRef.current);
      try {
        room.unregisterByteStreamHandler(TOPIC_SESSION_MESSAGES);
        room.off("dataReceived", onDataReceived);
      } catch (e) {}
    };
  }, [room]);

  const { chatMessages, send, isSending } = useChat();

  const agentIdentities = useMemo(() => {
    const ids = new Set();
    if (agent?.identity) ids.add(agent.identity);
    for (const p of participants) {
      if (p.isAgent) ids.add(p.identity);
    }
    return ids;
  }, [agent?.identity, participants]);

  const messages = useMemo(() => {
    const localId = localParticipant?.identity;
    const byStream = new Map();

    for (const item of transcriptions) {
      const text = item.text?.trim();
      if (!text) continue;

      const { identity } = item.participantInfo;
      const isUser = identity === localId;
      const isAgent = agentIdentities.has(identity);

      byStream.set(item.streamInfo.id, {
        id: item.streamInfo.id,
        text,
        timestamp: item.streamInfo.timestamp,
        role: isUser ? "user" : isAgent ? "agent" : "other",
        isFinal: isFinalStream(item.streamInfo),
      });
    }

    return Array.from(byStream.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }, [transcriptions, localParticipant?.identity, agentIdentities]);

  const conversationMessages = useMemo(() => {
    const chatItems = chatMessages.map((item) => {
      const fromId = item.from?.identity;
      const isUser = fromId && fromId === localParticipant?.identity;
      const isAgent = fromId ? agentIdentities.has(fromId) : false;

      return {
        id: item.id,
        text: item.message,
        timestamp: item.timestamp,
        role: isUser ? "user" : isAgent ? "agent" : "other",
        source: "chat",
      };
    });

    const transcriptItems = messages.map((item) => ({
      ...item,
      source: "transcript",
    }));

    return [...transcriptItems, ...chatItems, ...toolCalls].sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }, [agentIdentities, chatMessages, localParticipant?.identity, messages, toolCalls]);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [conversationMessages]);

  async function handleSubmit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;

    setDraft("");
    try {
      await send(text);
    } catch {
      setDraft(text);
    }
  }

  async function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await handleSubmit(event);
    }
  }

  if (disabledByMiniAzer) {
    return (
      <aside className="conversation-panel" style={{ opacity: 0.65, pointerEvents: "none" }}>
        <header className="conversation-header">
          <div>
            <p className="conversation-kicker">{t("textStream")}</p>
            <h2>{t("conversation")}</h2>
          </div>
          <span className="agent-status" data-state="tool-running">
            {t("miniAzerActiveStatus")}
          </span>
        </header>

        <ul className="conversation-messages">
          <li className="conversation-empty" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
            {t("miniAzerChatDisabled")}
          </li>
        </ul>

        <form className="conversation-composer" onSubmit={(event) => event.preventDefault()}>
          <label className="conversation-composer__label" htmlFor="chat-draft-mini-disabled">
            {t("typeMessage")}
          </label>
          <div className="conversation-composer__row">
            <textarea
              id="chat-draft-mini-disabled"
              className="conversation-composer__input"
              placeholder={t("miniAzerChatDisabledTextarea")}
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

  return (
    <aside className="conversation-panel">
      <header className="conversation-header">
        <div>
          <p className="conversation-kicker">{t("textStream")}</p>
          <h2>{t("conversation")}</h2>
        </div>
        <span className="agent-status" data-state={backgroundToolCompleted ? "tool-completed" : (activeTool || backgroundTool) ? "tool-running" : agentState}>
          {backgroundToolCompleted ? `${t("toolCompleted")} ${backgroundToolCompleted}` :
          activeTool || backgroundTool ? `${t("toolRunning")} ${activeTool || backgroundTool}` : (() => {
            const statusMap = {
              connecting: t("agentWaiting"),
              disconnected: t("agentOffline"),
              listening: t("agentListening"),
              thinking: t("agentThinking"),
              speaking: t("agentSpeaking"),
            };
            const state = agentState ?? "connecting";
            return `${t("agentStatusPrefix")} ${statusMap[state] || state}`;
          })()}
        </span>
      </header>

      <ul className="conversation-messages" ref={listRef}>
        {conversationMessages.length === 0 ? (
          <li className="conversation-empty">
            {t("conversationEmpty")}
          </li>
        ) : (
          conversationMessages.map((msg) => (
            <li
              key={msg.id}
              className={`conversation-bubble conversation-bubble--${msg.role}${
                msg.source === "chat"
                  ? " conversation-bubble--chat"
                  : msg.isFinal
                    ? " is-final"
                    : " is-live"
              }`}
            >
              <div className="conversation-bubble-header">
                <span className="conversation-label">
                  {msg.role === "user"
                    ? t("you")
                    : msg.role === "agent"
                      ? t("agentLabel")
                      : msg.role === "tool"
                        ? t("toolUsed")
                        : t("participantLabel")}
                </span>
                {msg.timestamp && (
                  <span className="conversation-time">
                    {formatDateTime(msg.timestamp)}
                  </span>
                )}
              </div>
              <p className="conversation-text">{msg.text}</p>
            </li>
          ))
        )}
      </ul>

      <form className="conversation-composer" onSubmit={handleSubmit}>
        <label className="conversation-composer__label" htmlFor="chat-draft">
          {t("typeMessage")}
        </label>
        <div className="conversation-composer__row">
          <textarea
            id="chat-draft"
            className="conversation-composer__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("typeMessagePlaceholder")}
            rows={2}
          />
          <button
            className="conversation-composer__send"
            type="submit"
            disabled={!draft.trim() || isSending}
          >
            {isSending ? t("sending") : t("send")}
          </button>
        </div>
      </form>
    </aside>
  );
}
