// Caption overlay - shows user and agent speech on screen center
const { ipcRenderer } = require('electron');

const userCaption = document.getElementById('userCaption');
const agentCaption = document.getElementById('agentCaption');
const userText = document.getElementById('userText');
const agentText = document.getElementById('agentText');

// Timers for auto-hiding
let userHideTimer = null;
let agentHideTimer = null;

// Listen for caption updates from main process
ipcRenderer.on('caption:update', (event, data) => {
  if (data.role === 'user') {
    showCaption(userCaption, userText, data.text, data.isFinal, 'user');
  } else if (data.role === 'agent') {
    showCaption(agentCaption, agentText, data.text, data.isFinal, 'agent');
  }
});

// Clear all captions (on disconnect)
ipcRenderer.on('caption:clear', () => {
  hideCaption(userCaption, userText, true);
  hideCaption(agentCaption, agentText, true);
});

function showCaption(lineEl, textEl, text, isFinal, role) {
  // Clear existing hide timer
  if (lineEl === userCaption && userHideTimer) {
    clearTimeout(userHideTimer);
    userHideTimer = null;
  }
  if (lineEl === agentCaption && agentHideTimer) {
    clearTimeout(agentHideTimer);
    agentHideTimer = null;
  }

  // Set text
  textEl.textContent = text;

  // Show with animation
  lineEl.classList.add('visible');
  lineEl.classList.remove('final');

  // Add role class for styling
  if (role === 'agent') {
    lineEl.classList.add('caption-agent');
  } else {
    lineEl.classList.remove('caption-agent');
  }

  // Typing cursor for live transcription
  if (!isFinal) {
    textEl.classList.add('typing');
  } else {
    textEl.classList.remove('typing');
    lineEl.classList.add('final');
  }

  // Auto-hide after delay (for BOTH user and agent)
  const hideDelay = 5000; // 5 seconds after final
  const timer = setTimeout(() => {
    hideCaption(lineEl, textEl);
  }, hideDelay);

  if (lineEl === userCaption) userHideTimer = timer;
  else agentHideTimer = timer;
}

function hideCaption(lineEl, textEl, immediate) {
  if (immediate) {
    lineEl.classList.remove('visible', 'final');
    textEl.classList.remove('typing');
    textEl.textContent = '';
  } else {
    lineEl.classList.remove('visible');
    textEl.classList.remove('typing');
    // Clear text after transition
    setTimeout(() => {
      lineEl.classList.remove('final');
      textEl.textContent = '';
    }, 500);
  }
}
