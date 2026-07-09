/**
 * @fileoverview Gesture X Service Worker — main entry point.
 * Responsibilities:
 *   - Initialize storage and keepalive on install/startup
 *   - Route all inter-component messages
 *   - Manage the offscreen document lifecycle
 *   - Orchestrate Chrome API controllers (added in Milestone 5)
 */

import { startKeepAlive, handleKeepAliveAlarm } from './KeepAlive.js';
import { initializeStorage, getSession, updateSession, getSettings, saveSettings, updateSetting, resetSettings } from '../shared/StorageManager.js';
import { onMessage, sendToTab, broadcastToAllTabs } from '../shared/MessageBus.js';
import { validateMessage } from '../shared/CommandSchema.js';
import { installGlobalErrorHandlers, safeAsync } from '../shared/ErrorHandler.js';
import {
  MessageType,
  ComponentId,
  OFFSCREEN_URL,
  OFFSCREEN_REASONS,
  OFFSCREEN_JUSTIFICATION,
  CommandId,
} from '../shared/constants.js';
import { createLogger } from '../shared/Logger.js';

const log = createLogger('ServiceWorker');

// ---------------------------------------------------------------------------
// Native Messaging for Virtual Mouse
// ---------------------------------------------------------------------------

let nativePort = null;
let lastVirtualMouseSettings = null;

function ensureNativePort(settings) {
  if (!settings.enableVirtualMouse) {
    if (nativePort) {
      nativePort.disconnect();
      nativePort = null;
      log.info('Native port disconnected (Virtual Mouse disabled)');
    }
    return;
  }

  if (!nativePort) {
    try {
      nativePort = chrome.runtime.connectNative('com.gesturex.mouse');
      nativePort.onDisconnect.addListener(() => {
        log.warn('Native port disconnected: ' + (chrome.runtime.lastError?.message || 'Unknown error'));
        nativePort = null;
      });
      nativePort.onMessage.addListener((msg) => {
        log.debug('Native msg:', msg);
      });
      log.info('Native port connected');
    } catch (e) {
      log.error('Failed to connect to native messaging host:', e);
    }
  }

  // Send latest settings
  if (nativePort && settings) {
    lastVirtualMouseSettings = {
      cursorSpeed: settings.virtualMouseSpeed ?? 1.0,
      cursorSmoothing: settings.virtualMouseSmoothing ?? 0.5,
      scrollSpeed: settings.virtualMouseScrollSpeed ?? 5.0
    };
    nativePort.postMessage({ settings: lastVirtualMouseSettings });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle — Install & Startup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  log.info(`Extension installed/updated — reason: ${details.reason}`);
  await safeAsync(() => initializeStorage(), 'onInstalled:initializeStorage');
  await safeAsync(() => startKeepAlive(), 'onInstalled:startKeepAlive');
});

chrome.runtime.onStartup.addListener(async () => {
  log.info('Browser started — Gesture X waking up');
  await safeAsync(() => initializeStorage(), 'onStartup:initializeStorage');
  await safeAsync(() => startKeepAlive(), 'onStartup:startKeepAlive');
});

// ---------------------------------------------------------------------------
// Keepalive alarm
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener((alarm) => {
  safeAsync(() => handleKeepAliveAlarm(alarm), 'onAlarm:keepAlive');
});

// ---------------------------------------------------------------------------
// Offscreen document management
// ---------------------------------------------------------------------------

/**
 * Ensures the offscreen document is created. Idempotent.
 *
 * @returns {Promise<void>}
 */
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existingContexts.length > 0) {
    log.debug('Offscreen document already exists');
    return;
  }

  log.info('Creating offscreen document...');
  await chrome.offscreen.createDocument({
    url:         chrome.runtime.getURL(OFFSCREEN_URL),
    reasons:     OFFSCREEN_REASONS,
    justification: OFFSCREEN_JUSTIFICATION,
  });
  log.info('Offscreen document created');
}

/**
 * Closes the offscreen document if it exists.
 *
 * @returns {Promise<void>}
 */
async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existingContexts.length === 0) {
    log.debug('No offscreen document to close');
    return;
  }

  await chrome.offscreen.closeDocument();
  log.info('Offscreen document closed');
}

// ---------------------------------------------------------------------------
// Voice Tab Management
// ---------------------------------------------------------------------------

const VOICE_TAB_URL = chrome.runtime.getURL('src/voice/voice.html');

/**
 * Ensures the voice tab is created and pinned.
 * @returns {Promise<void>}
 */
async function ensureVoiceTab() {
  const tabs = await chrome.tabs.query({ url: VOICE_TAB_URL });
  if (tabs.length > 0) {
    log.debug('Voice tab already exists');
    return;
  }
  
  log.info('Creating pinned voice tab...');
  await chrome.tabs.create({
    url: VOICE_TAB_URL,
    active: true, // Must be true initially so SpeechRecognition doesn't abort
    pinned: true,
  });
}

/**
 * Closes the voice tab if it exists.
 * @returns {Promise<void>}
 */
async function closeVoiceTab() {
  const tabs = await chrome.tabs.query({ url: VOICE_TAB_URL });
  if (tabs.length > 0) {
    log.info('Closing pinned voice tab...');
    await chrome.tabs.remove(tabs.map(t => t.id));
  }
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

/**
 * Central message handler. Validates all incoming messages,
 * then dispatches to the appropriate handler.
 *
 * @param {import('../shared/MessageBus.js').Message} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {function} sendResponse
 * @returns {boolean}
 */
function handleMessage(message, sender, sendResponse) {
  const { valid, reason } = validateMessage(message);
  if (!valid) {
    log.warn('Rejected invalid message', { reason, from: sender.id });
    return false;
  }

  log.debug(`← ${message.type} from ${message.source}`);

  switch (message.type) {
    // ------------------------------------------------------------------
    // Session control
    // ------------------------------------------------------------------
    case MessageType.TOGGLE_ACTIVE:
      safeAsync(() => handleToggleActive(message.payload, sendResponse), 'handleToggleActive');
      return true; // async response

    case MessageType.TOGGLE_GESTURE:
      safeAsync(() => handleToggleGesture(message.payload, sendResponse), 'handleToggleGesture');
      return true;

    case MessageType.TOGGLE_VOICE:
      safeAsync(() => handleToggleVoice(message.payload, sendResponse), 'handleToggleVoice');
      return true;

    case MessageType.GET_STATUS:
      handleGetStatus(sendResponse);
      return true;

    // ------------------------------------------------------------------
    // Offscreen document events
    // ------------------------------------------------------------------
    case MessageType.OFFSCREEN_READY:
      safeAsync(() => handleOffscreenReady(), 'handleOffscreenReady');
      return false;

    case MessageType.OFFSCREEN_ERROR:
      safeAsync(() => handleOffscreenError(message.payload), 'handleOffscreenError');
      return false;

    // ------------------------------------------------------------------
    // Gesture & voice events (forwarded to command router in Milestone 5)
    // ------------------------------------------------------------------
    case MessageType.GESTURE_CONFIRMED:
      safeAsync(() => handleGestureConfirmed(message.payload, sender), 'handleGestureConfirmed');
      return false;

    case MessageType.VOICE_COMMAND:
      safeAsync(() => handleVoiceCommand(message.payload, sender), 'handleVoiceCommand');
      return false;

    case MessageType.HAND_TRACKING:
      handleHandTracking(message.payload);
      return false;


    // ------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------
    case MessageType.GET_SETTINGS:
      safeAsync(() => handleGetSettings(sendResponse), 'handleGetSettings');
      return true;

    case MessageType.SETTINGS_CHANGED:
      safeAsync(() => handleSettingsChanged(message.payload), 'handleSettingsChanged');
      return false;

    default:
      log.warn(`Unhandled message type: ${message.type}`);
      return false;
  }
}

onMessage(handleMessage);



// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Toggles the global active state of Gesture X.
 * @param {{ active: boolean }} payload
 * @param {function} sendResponse
 */
async function handleToggleActive({ active }, sendResponse) {
  await updateSession('isActive', active);
  log.info(`Gesture X ${active ? 'activated' : 'deactivated'}`);

  if (active) {
    await safeAsync(() => ensureOffscreenDocument(), 'handleToggleActive:ensureOffscreen');
    const settings = await getSettings();
    if (settings.enableVoice) {
      await safeAsync(() => ensureVoiceTab(), 'handleToggleActive:ensureVoiceTab');
    }
  } else {
    await safeAsync(() => closeOffscreenDocument(), 'handleToggleActive:closeOffscreen');
    await safeAsync(() => closeVoiceTab(), 'handleToggleActive:closeVoiceTab');
    await updateSession('cameraActive', false);
    await updateSession('micActive', false);
    await updateSession('offscreenReady', false);
  }

  const session = await getSession();
  sendResponse({ success: true, session });

  // Notify all open popups of the new status.
  await broadcastStatusUpdate();
}

/**
 * Toggles gesture recognition independently of voice.
 * @param {{ enabled: boolean }} payload
 * @param {function} sendResponse
 */
async function handleToggleGesture({ enabled }, sendResponse) {
  const settings = await getSettings();
  settings.enableGesture = enabled;
  await saveSettings(settings);
  log.info(`Gesture recognition ${enabled ? 'enabled' : 'disabled'}`);
  sendResponse({ success: true });
}

/**
 * Toggles voice recognition independently of gestures.
 * @param {{ enabled: boolean }} payload
 * @param {function} sendResponse
 */
async function handleToggleVoice({ enabled }, sendResponse) {
  const settings = await getSettings();
  settings.enableVoice = enabled;
  await saveSettings(settings);
  log.info(`Voice recognition ${enabled ? 'enabled' : 'disabled'}`);
  
  const session = await getSession();
  if (session.isActive) {
    if (enabled) {
      await ensureVoiceTab();
      await updateSession('micActive', true);
      await broadcastToExtensionContexts(MessageType.START_SPEECH, null);
    } else {
      await updateSession('micActive', false);
      await broadcastToExtensionContexts(MessageType.STOP_SPEECH, null);
      await closeVoiceTab();
    }
    await broadcastStatusUpdate();
  }
  
  sendResponse({ success: true });
}

/**
 * Returns the current session state to the popup.
 * @param {function} sendResponse
 */
async function handleGetStatus(sendResponse) {
  const session  = await getSession();
  const settings = await getSettings();
  sendResponse({ session, settings });
}

/**
 * Marks the offscreen document as ready in session state,
 * then starts the camera and/or speech pipelines based on current settings.
 */
async function handleOffscreenReady() {
  await updateSession('offscreenReady', true);
  log.info('Offscreen document reported ready');

  const settings = await getSettings();
  const session  = await getSession();

  // Only start pipelines if Gesture X is actually active
  if (!session.isActive) {
    log.debug('Gesture X is not active — skipping pipeline start');
    return;
  }

  if (settings.enableGesture || settings.enableVirtualMouse) {
    await updateSession('cameraActive', true);
    await broadcastToExtensionContexts(MessageType.START_CAMERA, null);
  }

  if (settings.enableVoice) {
    await ensureVoiceTab();
    await updateSession('micActive', true);
    await broadcastToExtensionContexts(MessageType.START_SPEECH, null);
  }

  await broadcastStatusUpdate();
}

/**
 * Handles errors reported by the offscreen document.
 * Uses the optional `context` field to scope the reset:
 *  - 'speech'  → only resets mic state (preserves camera pipeline)
 *  - 'camera'  → only resets camera state (preserves speech pipeline)
 *  - undefined → full reset (offscreen document is unrecoverable)
 *
 * @param {{ error: string | Error, context?: 'speech' | 'camera' }} payload
 */
async function handleOffscreenError({ error, context }) {
  // Convert DOMException or Error objects to strings before storing,
  // as chrome.storage cannot serialize Error objects.
  const errorMessage = error?.message || String(error);
  log.error(`Offscreen error [${context ?? 'global'}]:`, errorMessage);

  if (context === 'speech') {
    await updateSession('micActive',  false);
    await updateSession('micError',   errorMessage);
  } else if (context === 'camera') {
    await updateSession('cameraActive', false);
    await updateSession('cameraError',  errorMessage);
  } else {
    // Full reset — entire offscreen document is in a bad state
    await updateSession('offscreenReady', false);
    await updateSession('cameraActive',   false);
    await updateSession('micActive',      false);
  }

  await broadcastStatusUpdate();
}


/**
 * Handles a confirmed gesture event.
 * Looks up the user's gesture binding and dispatches the mapped command.
 *
 * @param {{ label: string, confidence: number, hand: string, timestamp: number }} payload
 */
async function handleGestureConfirmed(payload) {
  const { label, confidence, hand } = payload;
  
  const settings = await getSettings();

  if (!settings.enableGesture) {
    log.debug(`Gesture ${label} ignored — gestures disabled in settings`);
    return;
  }

  // Prevent discrete gestures (like Swipes) from firing while the user is actively
  // holding a continuous drag gesture (e.g. Fist).
  if (isDragging) {
    log.info(`Gesture: ${label} (${(confidence * 100).toFixed(0)}%) — Ignored (Drag Active)`);
    return;
  }
  
  log.info(`Gesture: ${label} (${(confidence * 100).toFixed(0)}%) — ${hand} hand`);

  await updateSession('lastGesture', label);
  await updateSession('lastGestureTs', Date.now());

  const commandId = settings.gestureBindings[label];

  if (!commandId || commandId === CommandId.NONE) return;

  log.info(`Gesture: ${label} (${(confidence * 100).toFixed(0)}%) — ${hand} hand`);
  await safeAsync(() => executeCommand(commandId), `handleGestureConfirmed:${commandId}`);

  // Show HUD toast in active tab
  await safeAsync(
    () => sendHUDNotification({ label, commandId, hand, confidence, source: 'gesture' }),
    'handleGestureConfirmed:sendHUD'
  );
}

// ---------------------------------------------------------------------------
// Continuous drag tracking
// ---------------------------------------------------------------------------

let isDragging = false;
let dragTimeout = null;

/**
 * Handles high-frequency HAND_TRACKING messages from GestureEngine.
 * If the current gesture maps to DRAG_SCROLL, it forwards the drag state to the active tab.
 * Also forwards tracking data to Native Messaging if Virtual Mouse Mode is on.
 * @param {{ label: string, x: number, y: number, landmarks?: any, mlCategory?: string, mlScore?: number }} payload
 */
async function handleHandTracking(payload) {
  const { label, y, landmarks, mlCategory, mlScore } = payload;
  const settings = await getSettings();
  
  // 1. Virtual Mouse Routing
  if (settings.enableVirtualMouse) {
    ensureNativePort(settings);
    if (nativePort && landmarks) {
      nativePort.postMessage({
        landmarks,
        mlCategory,
        mlScore
      });
    }
  }
  // 2. Original DRAG_SCROLL Routing
  const commandId = settings.gestureBindings[label];

  if (commandId === CommandId.DRAG_SCROLL) {
    if (!isDragging) isDragging = true;
    
    // Always refresh the timeout. If we stop receiving DRAG_SCROLL frames for >150ms
    // (e.g. hand leaves camera, or ML model flickers), the drag stops automatically.
    if (dragTimeout) clearTimeout(dragTimeout);
    
    dragTimeout = setTimeout(async () => {
      isDragging = false;
      dragTimeout = null;
      
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) return;
      
      chrome.tabs.sendMessage(tab.id, {
        type: MessageType.EXECUTE_DRAG,
        payload: { stop: true },
        source: ComponentId.SERVICE_WORKER
      }).catch(() => {});
    }, 150);
    
    // Forward EXECUTE_DRAG to active tab
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) return;
    
    chrome.tabs.sendMessage(tab.id, {
      type: MessageType.EXECUTE_DRAG,
      payload: { y, stop: false },
      source: ComponentId.SERVICE_WORKER
    }).catch(() => {});
  }
}


/**
 * Handles a recognized voice command from SpeechEngine.
 * Translates transcript to CommandId via settings, executes it, and shows HUD.* @param {{ command: string, transcript: string, confidence: number, text?: string }} payload
 */
async function handleVoiceCommand(payload) {
  const { command, transcript, confidence, text } = payload;
  log.info(`Voice: "${transcript}" → ${command} (${(confidence * 100).toFixed(0)}%)`);

  await updateSession('lastVoiceCmd', command);

  if (!command || command === 'NONE') return;

  log.info(`→ Executing command: ${command}`);

  if (command === 'TYPE_TEXT') {
    // Route text typing directly to the active tab
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: MessageType.TYPE_TEXT,
        payload: { text },
        source: ComponentId.SERVICE_WORKER
      }).catch(() => {});
    }
    // We don't execute a built-in SW command for this, we just forward it.
  } else {
    // Standard SW-executed commands
    await safeAsync(() => executeCommand(command), `handleVoiceCommand:${command}`);
  }

  // Show HUD toast in active tab
  await safeAsync(
    () => sendHUDNotification({ label: transcript, commandId: command, hand: 'voice', confidence, source: 'voice' }),
    'handleVoiceCommand:sendHUD'
  );
}

// ---------------------------------------------------------------------------
// HUD notification helper
// ---------------------------------------------------------------------------

/**
 * Sends a SHOW_HUD message to the active tab's content script.
 * First pings with GESTURE_X_PING to verify the content script is loaded.
 * Silently no-ops if the tab has no content script (e.g. chrome:// pages).
 *
 * @param {object} payload - Toast payload for HUDManager.show().
 * @returns {Promise<void>}
 */
async function sendHUDNotification(payload) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return;

  // Verify content script is present before sending HUD message
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'GESTURE_X_PING',
      source: 'SERVICE_WORKER',
      timestamp: Date.now(),
    });
  } catch {
    // Content script not loaded on this tab (e.g. chrome://, file://, PDF, etc.)
    return;
  }

  // Retrieve HUD preferences from settings
  const settings     = await getSettings();
  const hudEnabled   = settings.feedbackHUD !== false; // default enabled
  const audioEnabled = settings.feedbackAudio === true; // default disabled

  if (audioEnabled) {
    chrome.runtime.sendMessage({
      type: 'PLAY_BEEP',
      source: 'SERVICE_WORKER',
      timestamp: Date.now()
    }).catch(() => {});
  }

  await chrome.tabs.sendMessage(tab.id, {
    type: 'SHOW_HUD',
    payload: { ...payload, hudEnabled },
    source: 'SERVICE_WORKER',
    timestamp: Date.now(),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Command executor — maps CommandId enum to Chrome API calls
// ---------------------------------------------------------------------------

/**
 * Executes a browser command given its CommandId string.
 * Each command uses the appropriate Chrome API.
 *
 * @param {string} commandId - A value from the CommandId enum.
 * @returns {Promise<void>}
 */
async function executeCommand(commandId) {

  // Helper: get current active tab
  const getActiveTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ?? null;
  };

  switch (commandId) {
    // --- Navigation ---
    case CommandId.NAV_BACK:
      await chrome.tabs.goBack();
      break;

    case CommandId.NAV_FORWARD:
      await chrome.tabs.goForward();
      break;

    case CommandId.NAV_RELOAD: {
      const tab = await getActiveTab();
      if (tab?.id) await chrome.tabs.reload(tab.id);
      break;
    }

    case CommandId.NAV_HOME: {
      const tab = await getActiveTab();
      if (tab?.id) await chrome.tabs.update(tab.id, { url: 'chrome://newtab' });
      break;
    }

    // --- Tabs ---
    case CommandId.TAB_NEW:
      await chrome.tabs.create({ active: true });
      break;

    case CommandId.TAB_CLOSE: {
      const tab = await getActiveTab();
      if (tab?.id) await chrome.tabs.remove(tab.id);
      break;
    }

    case CommandId.TAB_NEXT: {
      const tab = await getActiveTab();
      if (!tab) break;
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const idx     = allTabs.findIndex((t) => t.id === tab.id);
      const next    = allTabs[(idx + 1) % allTabs.length];
      if (next?.id) await chrome.tabs.update(next.id, { active: true });
      break;
    }

    case CommandId.TAB_PREV: {
      const tab = await getActiveTab();
      if (!tab) break;
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const idx     = allTabs.findIndex((t) => t.id === tab.id);
      const prev    = allTabs[(idx - 1 + allTabs.length) % allTabs.length];
      if (prev?.id) await chrome.tabs.update(prev.id, { active: true });
      break;
    }

    case CommandId.TAB_REOPEN:
      await chrome.sessions.restore();
      break;

    // --- Scrolling (injected into active tab content script) ---
    case CommandId.SCROLL_UP:
    case CommandId.SCROLL_DOWN:
    case CommandId.SCROLL_TOP:
    case CommandId.SCROLL_BOTTOM: {
      const tab = await getActiveTab();
      if (!tab?.id) break;
      await chrome.tabs.sendMessage(tab.id, {
        type:      'EXECUTE_SCROLL',
        direction: commandId,
        source:    'SERVICE_WORKER',
        timestamp: Date.now(),
      }).catch(() => {
        // Fallback: If content script is not injected (e.g. unrefreshed tab), try direct script injection
        return chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (dir) => {
            if (dir === 'SCROLL_UP') window.scrollBy({ top: -420, behavior: 'smooth' });
            else if (dir === 'SCROLL_DOWN') window.scrollBy({ top: 420, behavior: 'smooth' });
            else if (dir === 'SCROLL_TOP') window.scrollTo({ top: 0, behavior: 'smooth' });
            else if (dir === 'SCROLL_BOTTOM') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
          },
          args: [commandId]
        }).catch(() => {
          // If this ALSO fails, we are definitely on a restricted chrome:// page.
          console.warn('Cannot scroll on this restricted page (e.g. chrome:// or web store).');
        });
      });
      break;
    }

    // --- Zoom ---
    case CommandId.ZOOM_IN: {
      const tab = await getActiveTab();
      if (!tab?.id) break;
      const current = await chrome.tabs.getZoom(tab.id);
      await chrome.tabs.setZoom(tab.id, Math.min(3, current + 0.1));
      break;
    }

    case CommandId.ZOOM_OUT: {
      const tab = await getActiveTab();
      if (!tab?.id) break;
      const current = await chrome.tabs.getZoom(tab.id);
      await chrome.tabs.setZoom(tab.id, Math.max(0.25, current - 0.1));
      break;
    }

    case CommandId.ZOOM_RESET: {
      const tab = await getActiveTab();
      if (tab?.id) await chrome.tabs.setZoom(tab.id, 0);
      break;
    }

    // --- Window ---
    case CommandId.WINDOW_FULLSCREEN: {
      const win = await chrome.windows.getCurrent();
      const next = win.state === 'fullscreen' ? 'normal' : 'fullscreen';
      await chrome.windows.update(win.id, { state: next });
      break;
    }

    case CommandId.WINDOW_MINIMIZE: {
      const win = await chrome.windows.getCurrent();
      await chrome.windows.update(win.id, { state: 'minimized' });
      break;
    }

    // --- Bookmarks ---
    case CommandId.BOOKMARK_ADD: {
      const tab = await getActiveTab();
      if (tab?.url && tab?.title) {
        await chrome.bookmarks.create({ title: tab.title, url: tab.url });
        log.info(`Bookmarked: ${tab.title}`);
      }
      break;
    }

    case CommandId.NONE:
    default:
      log.debug(`executeCommand: no-op for ${commandId}`);
      break;
  }
}

/**
 * Returns the current settings to the settings page.
 * @param {function} sendResponse
 */
async function handleGetSettings(sendResponse) {
  const settings = await getSettings();
  sendResponse({ settings });
}

/**
 * Applies a single settings change.
 * Special key '__RESET__' triggers a full settings reset.
 * @param {{ key: string, value: unknown }} payload
 */
async function handleSettingsChanged({ key, value }) {
  if (key === '__RESET__') {
    await safeAsync(() => resetSettings(), 'handleSettingsChanged:reset');
    log.info('Settings reset to defaults');
    
    // Update native port with reset settings
    const settings = await getSettings();
    ensureNativePort(settings);
    return;
  }
  await safeAsync(() => updateSetting(key, value), `handleSettingsChanged:${key}`);
  log.info(`Setting updated: ${key}`);

  // Re-eval native port if virtual mouse settings changed
  if (key.startsWith('virtualMouse') || key === 'enableVirtualMouse') {
    const settings = await getSettings();
    ensureNativePort(settings);
  }

  // Re-eval camera pipeline if toggles changed
  if (key === 'enableGesture' || key === 'enableVirtualMouse') {
    const settings = await getSettings();
    const session = await getSession();
    if (session.isActive && session.offscreenReady) {
      if (settings.enableGesture || settings.enableVirtualMouse) {
        if (!session.cameraActive) {
          await updateSession('cameraActive', true);
          await broadcastToExtensionContexts(MessageType.START_CAMERA, null);
        }
      } else {
        if (session.cameraActive) {
          await updateSession('cameraActive', false);
          await broadcastToExtensionContexts(MessageType.STOP_CAMERA, null);
        }
      }
      await broadcastStatusUpdate();
    }
  }
}

// ---------------------------------------------------------------------------
// Status broadcast
// ---------------------------------------------------------------------------

/**
 * Sends a message to all non-tab extension contexts (popup, settings, offscreen).
 * Uses chrome.runtime.sendMessage which broadcasts to all extension listeners.
 * Content scripts are excluded (they use chrome.tabs.sendMessage).
 *
 * @param {string} type
 * @param {unknown} payload
 * @returns {Promise<void>}
 */
async function broadcastToExtensionContexts(type, payload) {
  const message = {
    type,
    payload:   payload ?? null,
    source:    ComponentId.SERVICE_WORKER,
    timestamp: Date.now(),
  };
  try {
    await chrome.runtime.sendMessage(message);
  } catch (err) {
    // Suppress "no receiver" — expected when no other contexts are open
    if (!err.message?.includes('Could not establish connection')) {
      log.warn(`broadcastToExtensionContexts failed for ${type}:`, err.message);
    }
  }
}

/**
 * Broadcasts the current session state to any open popup windows.
 *
 * @returns {Promise<void>}
 */
async function broadcastStatusUpdate() {
  const session  = await getSession();
  const settings = await getSettings();
  await broadcastToExtensionContexts(MessageType.STATUS_UPDATE, { session, settings });
}

// ---------------------------------------------------------------------------
// Global error handling
// ---------------------------------------------------------------------------

installGlobalErrorHandlers(ComponentId.SERVICE_WORKER);

log.info('Gesture X Service Worker started');
