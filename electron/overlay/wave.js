// Audio-reactive sound wave for Mini AzerAI overlay
// Communicates with main app via IPC for state + audio level
const { ipcRenderer } = require('electron');

const canvas = document.getElementById('waveCanvas');
const ctx = canvas.getContext('2d');
const statusTextEl = document.querySelector('.status-text');
const versionTextEl = document.getElementById('versionText');

// High-DPI support
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 280 * dpr;
  canvas.height = 280 * dpr;
  ctx.scale(dpr, dpr);
}
resizeCanvas();

// Audio setup
let audioContext = null;
let analyser = null;
let dataArray = null;
let bufferLength = 0;
let audioConnected = false;

// Smoothed values
let smoothedData = null;
const SMOOTH_FACTOR = 0.3;

// State
let isConnected = false;
let isSpeaking = false;
let isThinking = false;
let isTool = false;
let toolName = '';
let remoteAudioLevel = 0;
let currentAgentState = 'disconnected';
let currentLanguage = 'az';
let microphoneEnabled = true;
let cameraEnabled = false;
let screenShareEnabled = false;

const OVERLAY_TRANSLATIONS = {
  az: {
    noConnection: 'Bağlantı yoxdur',
    waiting: 'Gözləyir',
    tool: 'Alət',
    speaking: 'Danışır',
    thinking: 'Düşünür',
    listening: 'Dinləyir'
  },
  tr: {
    noConnection: 'Bağlantı yok',
    waiting: 'Bekliyor',
    tool: 'Araç',
    speaking: 'Konuşuyor',
    thinking: 'Düşünüyor',
    listening: 'Dinliyor'
  },
  en: {
    noConnection: 'No connection',
    waiting: 'Waiting',
    tool: 'Tool',
    speaking: 'Speaking',
    thinking: 'Thinking',
    listening: 'Listening'
  }
};

// Color palette per state
const STATE_COLORS = {
  listening:  { primary: '#00ffe5', secondary: '#00c8b4', glow: '#00ffe5', particle: '0, 255, 229' },
  thinking:   { primary: '#a78bfa', secondary: '#8b5cf6', glow: '#a78bfa', particle: '167, 139, 250' },
  speaking:   { primary: '#00ffe5', secondary: '#00c8b4', glow: '#00ffe5', particle: '0, 255, 229' },
  tool:       { primary: '#fbbf24', secondary: '#f59e0b', glow: '#fbbf24', particle: '251, 191, 36' },
  disconnected: { primary: '#f87171', secondary: '#ef4444', glow: '#f87171', particle: '248, 113, 113' },
};

function getCurrentColors() {
  if (!isConnected) return STATE_COLORS.disconnected;
  if (isTool) return STATE_COLORS.tool;
  if (isSpeaking) return STATE_COLORS.speaking;
  if (isThinking) return STATE_COLORS.thinking;
  return STATE_COLORS.listening;
}

// Status text per state
function getStatusText() {
  const trans = OVERLAY_TRANSLATIONS[currentLanguage] || OVERLAY_TRANSLATIONS.az;
  if (!isConnected) return trans.noConnection;
  if (currentAgentState === 'connecting') return trans.waiting;
  if (isTool) return `${trans.tool}: ${toolName}`;
  if (isSpeaking) return trans.speaking;
  if (isThinking) return trans.thinking;
  return trans.listening;
}

// Initialize audio
function initAudio() {
  if (audioConnected) return;
  
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    smoothedData = new Float32Array(bufferLength);

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        audioConnected = true;
      })
      .catch(err => {
        console.log('Mic denied, using idle + remote level:', err);
        audioConnected = false;
      });
  } catch (e) {
    console.log('Audio init error:', e);
  }
}

setTimeout(initAudio, 500);

// IPC: Listen for state changes from main app
const langBtnEl = document.getElementById('langBtn');
const languages = ['az', 'tr', 'en'];

if (langBtnEl) {
  langBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const currentIndex = languages.indexOf(currentLanguage);
    const nextIndex = (currentIndex + 1) % languages.length;
    const nextLang = languages[nextIndex];
    
    currentLanguage = nextLang;
    langBtnEl.textContent = nextLang.toUpperCase();
    
    // Notify main process and save setting
    ipcRenderer.invoke('azerai:change-language', nextLang);
    
    if (statusTextEl) {
      statusTextEl.textContent = getStatusText();
    }
  });
}

const micBtnEl = document.getElementById('micBtn');
if (micBtnEl) {
  micBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    microphoneEnabled = !microphoneEnabled;
    if (microphoneEnabled) {
      micBtnEl.classList.remove('muted');
      micBtnEl.textContent = '🎙️';
    } else {
      micBtnEl.classList.add('muted');
      micBtnEl.textContent = '🔇';
    }
    ipcRenderer.invoke('azerai:toggle-microphone');
  });
}

const camBtnEl = document.getElementById('camBtn');
if (camBtnEl) {
  camBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    cameraEnabled = !cameraEnabled;
    if (cameraEnabled) {
      camBtnEl.classList.remove('off');
      camBtnEl.textContent = '📷';
    } else {
      camBtnEl.classList.add('off');
      camBtnEl.textContent = '📵';
    }
    ipcRenderer.invoke('azerai:toggle-camera');
  });
}

const shareBtnEl = document.getElementById('shareBtn');
if (shareBtnEl) {
  shareBtnEl.addEventListener('click', (e) => {
    e.stopPropagation();
    screenShareEnabled = !screenShareEnabled;
    if (screenShareEnabled) {
      shareBtnEl.classList.add('active');
      shareBtnEl.textContent = '🖥️';
    } else {
      shareBtnEl.classList.remove('active');
      shareBtnEl.textContent = '🖥️';
    }
    ipcRenderer.invoke('azerai:toggle-screenshare');
  });
}

ipcRenderer.on('azerai:state', (event, state) => {
  isConnected = state.connected;
  isSpeaking = state.speaking;
  isThinking = state.thinking;
  isTool = state.tool || false;
  toolName = state.toolName || '';
  remoteAudioLevel = state.audioLevel || 0;
  currentAgentState = state.agentState || 'disconnected';

  if (state.language !== undefined) {
    currentLanguage = state.language;
    if (langBtnEl) {
      langBtnEl.textContent = currentLanguage.toUpperCase();
    }
  }

  if (state.microphoneEnabled !== undefined) {
    microphoneEnabled = state.microphoneEnabled;
    if (micBtnEl) {
      if (microphoneEnabled) {
        micBtnEl.classList.remove('muted');
        micBtnEl.textContent = '🎙️';
      } else {
        micBtnEl.classList.add('muted');
        micBtnEl.textContent = '🔇';
      }
    }
  }

  if (state.cameraEnabled !== undefined) {
    cameraEnabled = state.cameraEnabled;
    if (camBtnEl) {
      if (cameraEnabled) {
        camBtnEl.classList.remove('off');
        camBtnEl.textContent = '📷';
      } else {
        camBtnEl.classList.add('off');
        camBtnEl.textContent = '📵';
      }
    }
  }

  if (state.screenShareEnabled !== undefined) {
    screenShareEnabled = state.screenShareEnabled;
    if (shareBtnEl) {
      if (screenShareEnabled) {
        shareBtnEl.classList.add('active');
      } else {
        shareBtnEl.classList.remove('active');
      }
    }
  }

  // Update CSS classes for visual state
  document.body.classList.remove('disconnected', 'speaking', 'thinking', 'listening', 'tool', 'waiting');
  if (!isConnected) {
    document.body.classList.add('disconnected');
  } else if (isTool) {
    document.body.classList.add('tool');
  } else if (isSpeaking) {
    document.body.classList.add('speaking');
  } else if (isThinking) {
    document.body.classList.add('thinking');
  } else if (currentAgentState === 'connecting') {
    document.body.classList.add('waiting');
  } else {
    document.body.classList.add('listening');
  }

  // Update status text
  if (statusTextEl) {
    statusTextEl.textContent = getStatusText();
  }
});

// IPC: Listen for version string from main app
ipcRenderer.on('azerai:set-version', (event, version) => {
  if (versionTextEl) {
    versionTextEl.textContent = 'v' + version;
  }
});

// Get audio data with smoothing
function getAudioData() {
  if (audioConnected && analyser && dataArray) {
    analyser.getByteFrequencyData(dataArray);
    for (let i = 0; i < bufferLength; i++) {
      smoothedData[i] += (dataArray[i] - smoothedData[i]) * SMOOTH_FACTOR;
    }
    // Blend with remote audio level for stronger effect
    if (remoteAudioLevel > 0) {
      const boost = remoteAudioLevel * 80;
      for (let i = 0; i < bufferLength; i++) {
        smoothedData[i] = Math.min(255, smoothedData[i] + boost * (1 - i / bufferLength));
      }
    }
    return smoothedData;
  }
  return null;
}

// Idle wave when no audio
function getIdleData(time) {
  const data = new Float32Array(128);
  for (let i = 0; i < 128; i++) {
    const wave1 = Math.sin(time * 0.002 + i * 0.15) * 20;
    const wave2 = Math.sin(time * 0.003 + i * 0.08) * 15;
    const wave3 = Math.sin(time * 0.001 + i * 0.25) * 10;
    data[i] = Math.max(0, 25 + wave1 + wave2 + wave3);
  }
  return data;
}

// Remote-driven wave (when we only have the remote audio level, no mic)
function getRemoteDrivenData(time) {
  const data = new Float32Array(128);
  const level = remoteAudioLevel || 0;
  for (let i = 0; i < 128; i++) {
    const wave1 = Math.sin(time * 0.003 + i * 0.12) * 20;
    const wave2 = Math.cos(time * 0.002 + i * 0.2) * 15;
    const base = 20 + level * 80;
    data[i] = Math.max(0, base + wave1 + wave2 + Math.random() * level * 30);
  }
  return data;
}

// Tool-thinking wave (slower, more rhythmic for tool state)
function getToolData(time) {
  const data = new Float32Array(128);
  const level = 0.4; // moderate activity level
  for (let i = 0; i < 128; i++) {
    const wave1 = Math.sin(time * 0.004 + i * 0.1) * 30;
    const wave2 = Math.cos(time * 0.003 + i * 0.18) * 25;
    const base = 35 + level * 50;
    data[i] = Math.max(0, base + wave1 + wave2);
  }
  return data;
}

function getAverageVolume(data, len) {
  let sum = 0;
  for (let i = 0; i < len; i++) sum += data[i];
  return sum / len;
}

// ====== DRAWING ======

function drawCircularBars(cx, cy, innerRadius, data, dataLen, color, fadeColor, alpha, barWidth) {
  const numBars = Math.min(dataLen, 72);
  const step = Math.floor(dataLen / numBars);
  const angleStep = (Math.PI * 2) / numBars;
  
  ctx.save();
  ctx.globalAlpha = alpha;
  
  for (let i = 0; i < numBars; i++) {
    const dataIndex = i * step;
    const value = data[dataIndex] || 0;
    const barHeight = (value / 255) * 50;
    const angle = i * angleStep - Math.PI / 2;
    
    const x1 = cx + Math.cos(angle) * innerRadius;
    const y1 = cy + Math.sin(angle) * innerRadius;
    const x2 = cx + Math.cos(angle) * (innerRadius + barHeight);
    const y2 = cy + Math.sin(angle) * (innerRadius + barHeight);
    
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, fadeColor || 'rgba(0, 255, 229, 0)');
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = barWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

function drawCircularWave(cx, cy, radius, data, dataLen, color, alpha, amplitude, thickness) {
  const numPoints = Math.min(dataLen, 128);
  const step = Math.floor(dataLen / numPoints);
  
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  
  for (let i = 0; i <= numPoints; i++) {
    const idx = (i % numPoints) * step;
    const value = data[idx] || 0;
    const angle = (i / numPoints) * Math.PI * 2 - Math.PI / 2;
    const r = radius + (value / 255) * amplitude;
    
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = thickness;
  ctx.stroke();
  ctx.restore();
}

function drawGlowRing(cx, cy, radius, volume, color) {
  const glowIntensity = 0.15 + (volume / 255) * 0.4;
  const pulseRadius = radius + (volume / 255) * 8;
  
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 + (volume / 255) * 4;
  ctx.globalAlpha = glowIntensity;
  ctx.shadowColor = color;
  ctx.shadowBlur = 15 + (volume / 255) * 20;
  ctx.stroke();
  ctx.restore();
}

const particles = [];
const MAX_PARTICLES = 35;

function updateParticles(cx, cy, radius, volume, particleRGB) {
  const spawnRate = Math.floor((volume / 255) * 3);
  for (let i = 0; i < spawnRate && particles.length < MAX_PARTICLES; i++) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: Math.cos(angle) * (0.3 + Math.random() * 0.8),
      vy: Math.sin(angle) * (0.3 + Math.random() * 0.8),
      life: 1,
      decay: 0.01 + Math.random() * 0.02,
      size: 1 + Math.random() * 2,
      rgb: particleRGB
    });
  }
  
  ctx.save();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.rgb}, ${p.life * 0.7})`;
    ctx.shadowColor = `rgba(${p.rgb}, 0.5)`;
    ctx.shadowBlur = 6;
    ctx.fill();
  }
  ctx.restore();
}

// ====== MAIN LOOP ======

function animate(timestamp) {
  const idleTime = timestamp || 0;
  ctx.clearRect(0, 0, 280, 280);
  
  const cx = 140;
  const cy = 140;
  const colors = getCurrentColors();
  
  let audioData;
  let volume = 0;
  
  // Choose audio data source based on state
  if (isTool && !audioConnected) {
    audioData = getToolData(idleTime);
    volume = getAverageVolume(audioData, 128);
  } else if (audioConnected) {
    audioData = getAudioData();
    volume = audioData ? getAverageVolume(audioData, bufferLength) : 0;
  } else if (remoteAudioLevel > 0.05) {
    audioData = getRemoteDrivenData(idleTime);
    volume = getAverageVolume(audioData, 128);
  } else {
    audioData = getIdleData(idleTime);
    volume = getAverageVolume(audioData, 128);
  }
  
  // Fade color for bar gradients
  const fadeColor = `rgba(${colors.particle}, 0)`;
  
  // Draw layers with current state color
  drawGlowRing(cx, cy, 115, volume * 0.6, colors.glow);
  drawCircularBars(cx, cy, 105, audioData, audioData.length, colors.primary, fadeColor, 0.5, 2.5);
  drawCircularWave(cx, cy, 90, audioData, audioData.length, colors.primary, 0.6, 22, 1.5);
  drawGlowRing(cx, cy, 65, volume, colors.glow);
  
  const mirroredData = new Float32Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) {
    mirroredData[i] = audioData[audioData.length - 1 - i] * 0.5;
  }
  drawCircularBars(cx, cy, 60, mirroredData, mirroredData.length, colors.secondary, fadeColor, 0.35, 1.5);
  drawCircularWave(cx, cy, 48, audioData, audioData.length, colors.primary, 0.3, 10, 1);
  updateParticles(cx, cy, 95, volume, colors.particle);
  
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
