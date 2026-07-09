/**
 * @fileoverview Gesture X — Offscreen Document Orchestrator
 *
 * This is the top-level controller for the offscreen document.
 * It owns the camera and speech pipelines and coordinates their lifecycles
 * in response to messages from the service worker.
 *
 * Message flow:
 *   SW → offscreen: START_CAMERA, STOP_CAMERA, START_SPEECH, STOP_SPEECH, SW_HEARTBEAT
 *   offscreen → SW: OFFSCREEN_READY, OFFSCREEN_ERROR, GESTURE_CONFIRMED, VOICE_COMMAND
 *
 * Design notes:
 *   - The offscreen document is ephemeral: Chrome can destroy it at any time.
 *     All state is stored in chrome.storage.session, not in memory.
 *   - Camera and speech pipelines are independent — either can fail without
 *     taking down the other.
 *   - GestureEngine (M3) and SpeechEngine (M4) are injected via the
 *     pipeline slot pattern — offscreen.js is the composition root.
 */

import { CameraManager, CameraState } from './camera/CameraManager.js';
import { FrameCapture }               from './camera/FrameCapture.js';
import { GestureEngine }              from './gesture/GestureEngine.js';
import { onMessage, sendToRuntime }   from '../shared/MessageBus.js';
import { installGlobalErrorHandlers, safeAsync, reportError } from '../shared/ErrorHandler.js';
import { MessageType, ComponentId, StorageKey } from '../shared/constants.js';
import { createLogger } from '../shared/Logger.js';

const log = createLogger('Offscreen');

// ---------------------------------------------------------------------------
// DOM references (defined in offscreen.html)
// ---------------------------------------------------------------------------

const videoEl  = /** @type {HTMLVideoElement} */ (document.getElementById('gesture-x-video'));
const canvasEl = /** @type {HTMLCanvasElement} */ (document.getElementById('gesture-x-canvas'));

// ---------------------------------------------------------------------------
// Pipeline instances
// ---------------------------------------------------------------------------

/** @type {CameraManager | null} */
let cameraManager = null;

/** @type {FrameCapture | null} */
let frameCapture = null;

/** @type {GestureEngine | null} */
let gestureEngine = null;

/**
 * M3 plugin slot — GestureEngine will be set here by gesture/GestureEngine.js.
 * The offscreen orchestrator calls processFrame(bitmap) on each captured frame.
 *
 * @type {{ processFrame: function(ImageBitmap, number): Promise<void> } | null}
 */
let gestureEnginePlugin = null;



// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Entry point — called once when the offscreen document's DOM is ready.
 * Validates DOM elements, installs error handlers, wires up message listener,
 * registers engine plugins, and announces readiness to the service worker.
 */
async function init() {
  installGlobalErrorHandlers(ComponentId.OFFSCREEN);

  if (!videoEl || !canvasEl) {
    const msg = 'Offscreen DOM elements not found — offscreen.html may be malformed';
    log.error(msg);
    await notifyError(msg);
    return;
  }

  // Wire up the message listener before announcing readiness
  onMessage(handleMessage);

  // Announce to SW that offscreen is ready to receive commands
  await safeAsync(
    () => sendToRuntime(MessageType.OFFSCREEN_READY, null, ComponentId.OFFSCREEN),
    'offscreen:init:sendReady'
  );

  log.info('Offscreen document initialized and ready');
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

/**
 * Handles messages from the service worker.
 *
 * @param {import('../shared/MessageBus.js').Message} message
 * @returns {boolean}
 */
function handleMessage(message) {
  switch (message.type) {
    case MessageType.START_CAMERA:
      safeAsync(() => startCameraPipeline(), 'offscreen:startCamera');
      break;

    case MessageType.STOP_CAMERA:
      safeAsync(() => stopCameraPipeline(), 'offscreen:stopCamera');
      break;

    case MessageType.SW_HEARTBEAT:
      log.debug(`Heartbeat received from SW at ${new Date(message.payload.timestamp).toISOString()}`);
      break;

    case MessageType.PLAY_BEEP:
      playSubtleBeep();
      break;

    case MessageType.SETTINGS_CHANGED:
      if (gestureEngine) {
        gestureEngine.updateSettings(message.payload);
      }
      break;

    default:
      // Offscreen intentionally ignores messages meant for other contexts
      break;
  }

  return false; // No async response needed
}

// ---------------------------------------------------------------------------
// Camera pipeline
// ---------------------------------------------------------------------------

/**
 * Starts the camera pipeline:
 *  1. CameraManager.start() → acquires stream
 *  2. GestureEngine.initialize() → loads MediaPipe Hands WASM + model
 *  3. FrameCapture.start()  → begins RAF loop
 *  4. Registers GestureEngine as the frame consumer plugin
 *  5. Updates session storage → cameraActive: true
 */
async function startCameraPipeline() {
  if (cameraManager?.isActive) {
    log.debug('Camera pipeline already active');
    return;
  }

  log.info('Starting camera pipeline...');

  // 1. Start camera
  if (!cameraManager) {
    cameraManager = new CameraManager(videoEl, onCameraStateChange);
  }

  try {
    await cameraManager.start();
  } catch (err) {
    reportError(err, 'startCameraPipeline:CameraManager.start');
    await notifyError(err.message ?? 'Camera failed to start');
    return;
  }

  // 2. Initialize GestureEngine (loads MediaPipe Hands WASM)
  if (!gestureEngine) {
    gestureEngine = new GestureEngine(canvasEl);
  }
  try {
    await gestureEngine.initialize();
    
    // Fetch current settings and pass them to the engine
    sendToRuntime(MessageType.GET_SETTINGS, null, ComponentId.OFFSCREEN)
      .then((settings) => {
        if (settings) gestureEngine.updateSettings(settings);
      })
      .catch(() => {});

    // Register as the frame consumer plugin in the orchestrator
    registerGestureEngine(gestureEngine);
  } catch (err) {
    reportError(err, 'startCameraPipeline:GestureEngine.initialize');
    log.warn('GestureEngine failed to initialize — frames will be captured but not classified');
    // Don't abort the entire pipeline — camera still works without gestures
  }

  // 3. Start frame capture loop
  if (!frameCapture) {
    frameCapture = new FrameCapture(videoEl, onFrame, 30);
  }
  frameCapture.start();

  log.info('Camera pipeline active');
}

/**
 * Stops the camera pipeline cleanly:
 *  1. Stops FrameCapture loop
 *  2. Destroys GestureEngine (releases MediaPipe WASM resources)
 *  3. Releases camera stream
 *  4. Updates session storage → cameraActive: false
 */
async function stopCameraPipeline() {
  log.info('Stopping camera pipeline...');

  frameCapture?.stop();

  // Destroy GestureEngine to release WASM memory
  if (gestureEngine) {
    await safeAsync(() => gestureEngine.destroy(), 'stopCameraPipeline:gestureEngine.destroy');
    gestureEngine = null;
    gestureEnginePlugin = null; // clear plugin slot
  }

  await cameraManager?.stop();

  log.info('Camera pipeline stopped');
}

/**
 * Called on every captured frame from FrameCapture.
 * In M2: logs frame stats only.
 * In M3: will delegate to GestureEngine.processFrame().
 *
 * IMPORTANT: This function MUST close the bitmap when done to prevent GPU memory leaks.
 *
 * @param {ImageBitmap} bitmap - The captured frame (caller hands ownership to us).
 * @param {number} timestamp   - High-resolution timestamp from RAF.
 * @returns {Promise<void>}
 */
async function onFrame(bitmap, timestamp) {
  try {
    // M3 plugin slot: if GestureEngine is loaded, delegate to it
    if (gestureEnginePlugin) {
      await gestureEnginePlugin.processFrame(bitmap, timestamp);
      // GestureEngine is responsible for closing the bitmap
      return;
    }

    // M2 verification: confirm frames arrive (log every 150 frames ≈ every 5s)
    if (frameCapture && frameCapture.totalFrames % 150 === 1) {
      const settings = frameCapture.measuredFps > 0
        ? `${frameCapture.measuredFps}fps`
        : 'measuring...';
      log.debug(`Frame ${frameCapture.totalFrames} received — ${bitmap.width}×${bitmap.height} @ ${settings}`);
    }
  } finally {
    // Always close the bitmap — it holds GPU memory
    bitmap.close();
  }
}

/**
 * Handles camera state transitions from CameraManager.
 * @param {CameraState} state
 */
async function onCameraStateChange(state) {
  log.debug(`Camera state: ${state}`);

  if (state === CameraState.ERROR) {
    // await updateSessionField('cameraActive', false);
    await notifyError('Camera entered error state unexpectedly');
  }
}

// ---------------------------------------------------------------------------
// Plugin registration (called by M3/M4 modules after they load)
// ---------------------------------------------------------------------------

/**
 * Registers the GestureEngine plugin.
 * Called by GestureEngine.js (M3) after it initializes MediaPipe.
 *
 * @param {{ processFrame: function(ImageBitmap, number): Promise<void> }} engine
 */
export function registerGestureEngine(engine) {
  if (typeof engine?.processFrame !== 'function') {
    throw new TypeError('GestureEngine plugin must expose a processFrame(bitmap, ts) method');
  }
  gestureEnginePlugin = engine;
  log.info('GestureEngine plugin registered');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sends an error notification to the service worker.
 * @param {string} errorMessage
 * @returns {Promise<void>}
 */
async function notifyError(errorMessage) {
  await safeAsync(
    () => sendToRuntime(
      MessageType.OFFSCREEN_ERROR,
      { error: errorMessage },
      ComponentId.OFFSCREEN
    ),
    'offscreen:notifyError'
  );
}

// ---------------------------------------------------------------------------
// Audio Feedback
// ---------------------------------------------------------------------------

let audioContext = null;

/**
 * Plays a short, subtle, low-volume "beep" using the Web Audio API.
 * Provides haptic-like feedback for completed gestures and voice commands.
 */
function playSubtleBeep() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Resume context if browser suspended it (e.g. autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    // 800Hz is a clear, standard "beep" pitch
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);

    // Subtle volume (0.05) with a quick fade-out
    gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Play for 100ms
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch (err) {
    // Audio failures shouldn't break the extension, just log them
    log.warn('Failed to play audio feedback:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', init);
