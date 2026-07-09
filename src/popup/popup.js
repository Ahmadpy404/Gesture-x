/**
 * @fileoverview Gesture X Popup — main controller.
 * Manages UI state, communicates with the service worker,
 * and keeps the display in sync with extension state.
 */

import { sendToRuntimeWithResponse, sendToRuntime, onMessage } from '../shared/MessageBus.js';
import { installGlobalErrorHandlers, safeAsync } from '../shared/ErrorHandler.js';
import { MessageType, ComponentId } from '../shared/constants.js';
import { createLogger } from '../shared/Logger.js';

const log = createLogger('Popup');

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const powerBtn          = /** @type {HTMLButtonElement}  */ (document.getElementById('power-btn'));
const powerRing         = /** @type {HTMLDivElement}     */ (document.getElementById('power-ring'));
const powerStatusText   = /** @type {HTMLElement}        */ (document.getElementById('power-status-text'));
const cameraCard        = /** @type {HTMLDivElement}     */ (document.getElementById('camera-card'));
const cameraStatus      = /** @type {HTMLElement}        */ (document.getElementById('camera-status'));
const cameraDot         = /** @type {HTMLElement}        */ (document.getElementById('camera-dot'));
const micCard           = /** @type {HTMLDivElement}     */ (document.getElementById('mic-card'));
const micStatus         = /** @type {HTMLElement}        */ (document.getElementById('mic-status'));
const micDot            = /** @type {HTMLElement}        */ (document.getElementById('mic-dot'));
const gestureToggle     = /** @type {HTMLInputElement}   */ (document.getElementById('gesture-toggle'));
const mouseToggle       = /** @type {HTMLInputElement}   */ (document.getElementById('mouse-toggle'));
const voiceToggle       = /** @type {HTMLInputElement}   */ (document.getElementById('voice-toggle'));
const activityContent   = /** @type {HTMLDivElement}     */ (document.getElementById('activity-content'));
const activityTime      = /** @type {HTMLElement}        */ (document.getElementById('activity-time'));
const settingsBtn       = /** @type {HTMLAnchorElement}  */ (document.getElementById('settings-btn'));
const openSettingsFull  = /** @type {HTMLAnchorElement}  */ (document.getElementById('open-settings-full'));
const permBanner        = /** @type {HTMLDivElement}     */ (document.getElementById('perm-banner'));
const permBannerText    = /** @type {HTMLElement}        */ (document.getElementById('perm-banner-text'));
const permBannerLink    = /** @type {HTMLAnchorElement}  */ (document.getElementById('perm-banner-link'));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {{ session: object, settings: object } | null} */
let currentState = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Entry point — fetches state from SW and sets up UI.
 */
async function init() {
  installGlobalErrorHandlers(ComponentId.POPUP);
  attachEventListeners();
  await checkPermissions();
  await refreshState();
  log.info('Popup initialized');
}

// ---------------------------------------------------------------------------
// Permission checks
// ---------------------------------------------------------------------------

/**
 * Checks camera and microphone permission states via the Permissions API.
 * Shows the error banner if permissions have been denied.
 * This is advisory — the offscreen document will encounter the real error
 * if it tries to call getUserMedia on a denied permission.
 *
 * @returns {Promise<void>}
 */
async function checkPermissions() {
  try {
    const [camPerm, micPerm] = await Promise.all([
      navigator.permissions.query({ name: 'camera' }),
      navigator.permissions.query({ name: 'microphone' }),
    ]);

    const camDenied = camPerm.state === 'denied';
    const micDenied = micPerm.state === 'denied';

    if (camDenied || micDenied) {
      const denied = [camDenied && 'Camera', micDenied && 'Microphone']
        .filter(Boolean).join(' & ');
      showPermissionBanner(`${denied} access is blocked.`, 'chrome://settings/content/camera');
    } else {
      hidePermissionBanner();
    }

    // Re-check whenever permission state changes (e.g., user grants in settings)
    camPerm.addEventListener('change', () => checkPermissions());
    micPerm.addEventListener('change', () => checkPermissions());
  } catch {
    // Permissions API may not be available in all extension contexts — safe to ignore
    log.debug('Permissions API unavailable');
  }
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/**
 * Fetches the current session/settings state from the service worker
 * and updates the UI.
 *
 * @returns {Promise<void>}
 */
async function refreshState() {
  const result = await safeAsync(
    () => sendToRuntimeWithResponse(MessageType.GET_STATUS, null, ComponentId.POPUP),
    'popup:refreshState'
  );

  if (result) {
    currentState = result;
    renderState(result.session, result.settings);
  }
}

/**
 * Renders the full UI from session and settings state.
 *
 * @param {object} session
 * @param {object} settings
 */
function renderState(session, settings) {
  // Power button
  setActive(session.isActive);

  // Camera card
  setCardActive(cameraCard, cameraStatus, cameraDot, session.cameraActive, 'Active', 'Inactive');

  // Mic card — show error label if mic is blocked
  const micLabel = session.micError ? 'Blocked' : (session.micActive ? 'Listening' : 'Inactive');
  setCardActive(micCard, micStatus, micDot, session.micActive, micLabel, micLabel);

  // Permission banner — show if camera or mic is blocked
  if (session.micError) {
    showPermissionBanner('Microphone access is blocked.', 'chrome://settings/content/microphone');
  } else if (session.cameraError) {
    showPermissionBanner('Camera access is blocked.', 'chrome://settings/content/camera');
  } else {
    hidePermissionBanner();
  }

  // Feature toggles
  gestureToggle.checked = settings.enableGesture ?? true;
  gestureToggle.setAttribute('aria-checked', String(gestureToggle.checked));

  mouseToggle.checked = settings.enableVirtualMouse ?? true;
  mouseToggle.setAttribute('aria-checked', String(mouseToggle.checked));

  voiceToggle.checked = settings.enableVoice ?? true;
  voiceToggle.setAttribute('aria-checked', String(voiceToggle.checked));

  // Last activity
  renderActivity(session);
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Sets the global active/inactive state of the UI.
 * @param {boolean} active
 */
function setActive(active) {
  powerBtn.classList.toggle('active', active);
  powerBtn.setAttribute('aria-pressed', String(active));
  powerRing.classList.toggle('active', active);
  powerStatusText.textContent = active ? 'On' : 'Off';
  powerStatusText.classList.toggle('active', active);
}

/**
 * Updates a status card's visual state.
 * @param {HTMLElement} card
 * @param {HTMLElement} statusEl
 * @param {HTMLElement} dotEl
 * @param {boolean} active
 * @param {string} activeLabel
 * @param {string} inactiveLabel
 */
function setCardActive(card, statusEl, dotEl, active, activeLabel, inactiveLabel) {
  card.classList.toggle('active', active);
  statusEl.textContent = active ? activeLabel : inactiveLabel;
  dotEl.setAttribute('aria-label', `${statusEl.parentElement.querySelector('.status-card-label')?.textContent} ${active ? 'active' : 'inactive'}`);
}

/**
 * Renders the last activity chip.
 * @param {object} session
 */
function renderActivity(session) {
  const lastGesture = session.lastGesture;
  const lastVoice   = session.lastVoiceCmd;
  const lastTs      = session.lastGestureTs || 0;

  if (lastGesture || lastVoice) {
    const label = lastGesture
      ? formatGestureLabel(lastGesture)
      : `"${lastVoice}"`;
    const type  = lastGesture ? 'gesture' : 'voice';

    activityContent.innerHTML = '';
    const chip = document.createElement('span');
    chip.className = `activity-chip ${type}`;
    chip.textContent = label;
    activityContent.appendChild(chip);

    activityTime.textContent = lastTs
      ? formatRelativeTime(lastTs)
      : '—';
  } else {
    activityContent.innerHTML = '<span class="activity-empty">Nothing recognized yet</span>';
    activityTime.textContent = '—';
  }
}

/**
 * Converts a GestureLabel enum to a human-readable string.
 * @param {string} label
 * @returns {string}
 */
function formatGestureLabel(label) {
  return label
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Formats a timestamp as a relative time string.
 * @param {number} ts - Unix ms timestamp.
 * @returns {string}
 */
function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 5_000)   return 'Just now';
  if (diff < 60_000)  return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

/**
 * Helper to update a setting in the background.
 */
function updateSetting(key, value) {
  return sendToRuntime(
    MessageType.SETTINGS_CHANGED,
    { key, value },
    ComponentId.POPUP
  );
}

function attachEventListeners() {
  // Power button
  powerBtn.addEventListener('click', handlePowerToggle);

  // Gesture toggle
  gestureToggle.addEventListener('change', () => {
    safeAsync(
      () => updateSetting('enableGesture', gestureToggle.checked),
      'popup:toggleGesture'
    );
    gestureToggle.setAttribute('aria-checked', String(gestureToggle.checked));
  });

  // Mouse toggle
  mouseToggle.addEventListener('change', () => {
    safeAsync(
      () => updateSetting('enableVirtualMouse', mouseToggle.checked),
      'popup:toggleMouse'
    );
    mouseToggle.setAttribute('aria-checked', String(mouseToggle.checked));
  });

  // Voice toggle
  voiceToggle.addEventListener('change', () => {
    safeAsync(
      () => updateSetting('enableVoice', voiceToggle.checked),
      'popup:toggleVoice'
    );
    voiceToggle.setAttribute('aria-checked', String(voiceToggle.checked));
  });

  // Permission banner fix link — open chrome://settings/content/camera
  permBannerLink?.addEventListener('click', (e) => {
    e.preventDefault();
    // chrome:// URLs cannot be opened via window.open from extensions;
    // we open the extension permissions page instead.
    chrome.tabs.create({ url: 'chrome://settings/content/camera' });
  });

  // Settings button (header icon)
  settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openSettings();
  });

  // Settings link (footer)
  openSettingsFull.addEventListener('click', (e) => {
    e.preventDefault();
    openSettings();
  });

  // Listen for status updates pushed from SW
  onMessage((message) => {
    if (message.type === MessageType.STATUS_UPDATE && message.payload) {
      renderState(message.payload.session, message.payload.settings);
    }
    return false;
  });
}

/**
 * Handles the power button click — sends toggle to SW and updates UI optimistically.
 */
async function handlePowerToggle() {
  const isCurrentlyActive = powerBtn.getAttribute('aria-pressed') === 'true';
  const newActive = !isCurrentlyActive;

  // Optimistic UI update
  setActive(newActive);

  const result = await safeAsync(
    () => sendToRuntimeWithResponse(
      MessageType.TOGGLE_ACTIVE,
      { active: newActive },
      ComponentId.POPUP
    ),
    'popup:handlePowerToggle'
  );

  if (result?.session) {
    // Reconcile with actual state from SW
    renderState(result.session, currentState?.settings ?? {});
  }
}

/**
 * Opens the settings page in a new tab.
 */
function openSettings() {
  chrome.runtime.openOptionsPage();
}

// ---------------------------------------------------------------------------
// Permission banner helpers
// ---------------------------------------------------------------------------

/**
 * Shows the amber permission error banner with a message and optional fix URL.
 * @param {string} message  - Human-readable description of what's blocked.
 * @param {string} [fixUrl] - URL to open when user clicks 'Fix'.
 */
function showPermissionBanner(message, fixUrl) {
  if (!permBanner) return;
  permBannerText.textContent = message;
  if (fixUrl && permBannerLink) {
    permBannerLink.dataset.fixUrl = fixUrl;
    permBannerLink.hidden = false;
  } else if (permBannerLink) {
    permBannerLink.hidden = true;
  }
  permBanner.hidden = false;
}

/**
 * Hides the permission banner.
 */
function hidePermissionBanner() {
  if (permBanner) permBanner.hidden = true;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', init);
