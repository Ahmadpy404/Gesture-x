/**
 * @fileoverview Gesture X — GestureEngine
 *
 * Top-level gesture recognition pipeline. Wraps MediaPipe Hands and wires
 * it to the GestureClassifier and GestureDebouncer.
 *
 * Data flow:
 *   ImageBitmap (from FrameCapture)
 *     → draw to canvas
 *     → MediaPipe Hands.send()
 *     → onResults: NormalizedLandmarkList[21]
 *     → GestureClassifier.classify()    → { label, confidence }
 *     → GestureDebouncer.update()       → fires onConfirmed after holdDuration
 *     → sendToRuntime(GESTURE_CONFIRMED) → ServiceWorker
 *
 * MediaPipe integration notes:
 *  - Uses @mediapipe/tasks-vision GestureRecognizer (V2).
 *  - WASM and model files are loaded from the local assets directory.
 *  - The canvas element is provided by the offscreen.html DOM.
 */

import { GestureRecognizer, FilesetResolver } from '../../assets/mediapipe/tasks-vision/vision_bundle.mjs';

import { GestureClassifier }            from './GestureClassifier.js';
import { GestureDebouncer }             from './GestureDebouncer.js';
import { getPalmCenter }                from './GestureUtils.js';
import { sendToRuntime, sendToRuntimeWithResponse } from '../../shared/MessageBus.js';
import { GestureXError, ErrorType, reportError } from '../../shared/ErrorHandler.js';
import { MessageType, ComponentId }     from '../../shared/constants.js';
import { createLogger }                 from '../../shared/Logger.js';

const log = createLogger('GestureEngine');

// ---------------------------------------------------------------------------
// MediaPipe model configuration
// ---------------------------------------------------------------------------

const MEDIAPIPE_CONFIG = Object.freeze({
  numHands: 1,
  minHandDetectionConfidence: 0.7,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

// ---------------------------------------------------------------------------
// GestureEngine
// ---------------------------------------------------------------------------

export class GestureEngine {
  /** @type {GestureRecognizer | null} MediaPipe Tasks Vision GestureRecognizer instance. */
  #recognizer = null;

  /** @type {HTMLCanvasElement} */
  #canvas;

  /** @type {CanvasRenderingContext2D} */
  #ctx;

  /** @type {GestureClassifier} */
  #classifier = new GestureClassifier();

  /** @type {GestureDebouncer | null} */
  #debouncer = null;

  /** @type {boolean} */
  #initialized = false;

  /** @type {boolean} */
  #isVirtualMouseMode = false;

  /** @type {number} Total frames processed. */
  #frameCount = 0;

  /** @type {number} Frames where a hand was detected. */
  #detectedCount = 0;

  /**
   * @param {HTMLCanvasElement} canvas - The offscreen canvas for frame drawing.
   */
  constructor(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new GestureXError(
        'GestureEngine requires an HTMLCanvasElement',
        ErrorType.MEDIAPIPE,
        ComponentId.OFFSCREEN
      );
    }
    this.#canvas = canvas;
    this.#ctx    = canvas.getContext('2d', { willReadFrequently: false });
    log.debug('GestureEngine constructed');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Initializes MediaPipe Hands and the gesture debouncer.
   * Must be called before processFrame().
   *
   * @returns {Promise<void>}
   * @throws {GestureXError} If MediaPipe is not available or fails to init.
   */
  async initialize() {
    if (this.#initialized) {
      log.debug('GestureEngine already initialized');
      return;
    }

    // Verify imported
    if (!GestureRecognizer || !FilesetResolver) {
      throw new GestureXError(
        'MediaPipe Tasks Vision not found.',
        ErrorType.MEDIAPIPE,
        ComponentId.OFFSCREEN
      );
    }

    log.info('Initializing MediaPipe GestureRecognizer...');

    const response = await sendToRuntimeWithResponse(
      MessageType.GET_SETTINGS,
      null,
      ComponentId.OFFSCREEN
    );
    const settings = response?.settings || {};
    this.#isVirtualMouseMode = settings.enableVirtualMouse === true;

    // Create debouncer with current settings
    this.#debouncer = new GestureDebouncer({
      holdDuration: settings.holdDuration ?? 300,
      cooldownMs:   settings.gestureCooldown ?? 800,
      onConfirmed:  this.#onGestureConfirmed.bind(this),
    });

    try {
      const vision = await FilesetResolver.forVisionTasks(
        chrome.runtime.getURL('src/assets/mediapipe/tasks-vision/wasm')
      );

      this.#recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: chrome.runtime.getURL('src/assets/mediapipe/gesture_recognizer.task'),
          delegate: "CPU", // GPU is unreliable in headless offscreen documents
        },
        runningMode: "VIDEO",
        numHands: MEDIAPIPE_CONFIG.numHands,
        minHandDetectionConfidence: settings.sensitivity ?? MEDIAPIPE_CONFIG.minHandDetectionConfidence,
        minHandPresenceConfidence: MEDIAPIPE_CONFIG.minHandPresenceConfidence,
        minTrackingConfidence: Math.max(0.3, (settings.sensitivity ?? 0.7) - 0.2),
      });
    } catch (err) {
      throw new GestureXError(
        'Failed to initialize GestureRecognizer: ' + err.message,
        ErrorType.MEDIAPIPE,
        ComponentId.OFFSCREEN
      );
    }

    this.#initialized = true;
    log.info('MediaPipe GestureRecognizer initialized ✅');
  }

  /**
   * Processes a single captured video frame.
   * This is the method registered as the GestureEngine plugin in offscreen.js.
   *
   * IMPORTANT: This method takes ownership of the bitmap and MUST close it.
   *
   * @param {ImageBitmap} bitmap - Captured frame (ownership transferred to us).
   * @param {number} timestamp   - performance.now() from FrameCapture.
   * @returns {Promise<void>}
   */
  async processFrame(bitmap, timestamp) {
    if (!this.#initialized || !this.#recognizer) {
      bitmap.close();
      return;
    }

    this.#frameCount++;

    try {
      // Resize canvas to match frame and draw
      if (this.#canvas.width !== bitmap.width || this.#canvas.height !== bitmap.height) {
        this.#canvas.width  = bitmap.width;
        this.#canvas.height = bitmap.height;
      }
      this.#ctx.drawImage(bitmap, 0, 0);
    } finally {
      // Always close the bitmap immediately after drawing — releases GPU memory
      bitmap.close();
    }

    // Send canvas frame to MediaPipe Tasks Vision
    try {
      const results = this.#recognizer.recognizeForVideo(this.#canvas, timestamp);
      this.#onResults(results, timestamp);
    } catch (err) {
      log.warn('MediaPipe recognizeForVideo() failed', err.message);
    }
  }

  /**
   * Updates debouncer configuration from new settings.
   * Safe to call while the engine is running.
   *
   * @param {{ holdDuration?: number, gestureCooldown?: number, sensitivity?: number, enableVirtualMouse?: boolean }} settings
   */
  updateSettings({ holdDuration, gestureCooldown, sensitivity, enableVirtualMouse }) {
    if (enableVirtualMouse !== undefined) {
      this.#isVirtualMouseMode = enableVirtualMouse === true;
    }
    
    this.#debouncer?.updateConfig(
      holdDuration  ?? 300,
      gestureCooldown ?? 800
    );
    if (sensitivity !== undefined && this.#recognizer) {
      this.#recognizer.setOptions({
        minHandDetectionConfidence: sensitivity,
        minTrackingConfidence:  Math.max(0.3, sensitivity - 0.2),
      });
    }
  }

  /**
   * Destroys the MediaPipe instance and clears state.
   * Call when the camera pipeline is stopped.
   *
   * @returns {Promise<void>}
   */
  async destroy() {
    if (this.#recognizer) {
      this.#recognizer.close();
      this.#recognizer = null;
    }
    this.#debouncer?.reset();
    this.#initialized = false;
    log.info(`GestureEngine destroyed — ${this.#frameCount} frames, ${this.#detectedCount} with hand`);
  }

  /** @returns {boolean} */
  get isInitialized() { return this.#initialized; }

  // -------------------------------------------------------------------------
  // Private — MediaPipe results callback
  // -------------------------------------------------------------------------

  /**
   * Called with results from MediaPipe Tasks Vision GestureRecognizer.
   *
   * @param {object} results - GestureRecognizerResult
   * @param {number} timestamp - performance.now()
   */
  #onResults(results, timestamp) {
    const hasHand  = results.landmarks?.length > 0;

    if (!hasHand) {
      this.#classifier.reset();
      this.#debouncer?.update(null, 'Right', timestamp);
      return;
    }

    this.#detectedCount++;

    // Use first detected hand
    const landmarks  = results.landmarks[0];
    const handedness = results.handednesses?.[0]?.[0]?.displayName ?? 'Right';
    
    // The ML model's predicted gesture (e.g., 'Closed_Fist', 'Open_Palm', 'None')
    const mlGesture = results.gestures?.[0]?.[0];
    const mlCategory = mlGesture?.categoryName ?? 'None';
    const mlScore    = mlGesture?.score ?? 0;

    // Optional debug logging to trace model output
    // log.debug(`ML Result: ${mlCategory} (${mlScore.toFixed(2)})`);

    // Map mlCategory directly to GestureLabel to prevent velocity overrides
    // from breaking continuous drag when the user moves their hand quickly.
    let rawLabel = null;
    switch (mlCategory) {
      case 'Closed_Fist': rawLabel = 'FIST'; break;
      case 'Open_Palm':   rawLabel = 'OPEN_PALM'; break;
      case 'Victory':     rawLabel = 'PEACE'; break;
      case 'Thumb_Up':    rawLabel = 'THUMBS_UP'; break;
      case 'Thumb_Down':  rawLabel = 'THUMBS_DOWN'; break;
    }



    const sensitivity = 0.7;

    // Pass the ML gesture into our classifier, which will prioritize Swipes
    // and map the MediaPipe ML names to our GestureLabel enums.
    const classResult = this.#classifier.classify(landmarks, handedness, timestamp, sensitivity, mlCategory, mlScore);

    this.#debouncer?.update(
      classResult.label ? classResult : null,
      handedness,
      timestamp
    );

    // Stream raw hand tracking data for continuous drag features (1-to-1 tracking)
    // and Virtual Mouse Mode Native Messaging.
    const palm = getPalmCenter(landmarks);
    sendToRuntime(
      MessageType.HAND_TRACKING,
      { 
        label: rawLabel || classResult.label, 
        x: palm.x, 
        y: palm.y,
        landmarks: landmarks, // Sent for virtual mouse
        mlCategory: mlCategory,
        mlScore: mlScore
      },
      ComponentId.OFFSCREEN
    ).catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Private — confirmed gesture handler
  // -------------------------------------------------------------------------

  /**
   * Called by GestureDebouncer when a gesture has been held long enough.
   * Sends GESTURE_CONFIRMED to the service worker.
   *
   * @param {{ label: string, confidence: number, hand: string, timestamp: number }} event
   */
  #onGestureConfirmed(event) {
    sendToRuntime(
      MessageType.GESTURE_CONFIRMED,
      event,
      ComponentId.OFFSCREEN
    ).catch((err) => {
      reportError(err, 'GestureEngine.onGestureConfirmed:sendToRuntime');
    });
  }
}
