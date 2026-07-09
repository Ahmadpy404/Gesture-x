/**
 * @fileoverview Gesture X — FrameCapture
 * Drives a requestAnimationFrame loop that extracts frames from the camera
 * video element and delivers them to a consumer callback at a controlled rate.
 *
 * Responsibilities:
 *  - Run an RAF loop tied to the video element's frame cadence
 *  - Enforce a target frame rate (default 30fps) with frame skipping
 *  - Capture frames as ImageBitmap (zero-copy, GPU-accelerated)
 *  - Track and expose real-time FPS metrics for debugging
 *  - Cleanly start, stop, and restart without resource leaks
 *  - Integrate a plugin point so M3's GestureEngine receives frames directly
 *
 * Design note: FrameCapture is deliberately decoupled from GestureEngine.
 * It knows nothing about landmarks or commands — it only captures frames
 * and fires the onFrame callback. This makes it testable in isolation.
 */

import { createLogger } from '../../shared/Logger.js';

const log = createLogger('FrameCapture');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default target frames per second. */
const DEFAULT_TARGET_FPS = 30;

/** Maximum number of ImageBitmap objects to keep in-flight simultaneously. */
const MAX_INFLIGHT_FRAMES = 2;

/** How often to log FPS metrics (ms). */
const FPS_LOG_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// FrameCapture
// ---------------------------------------------------------------------------

export class FrameCapture {
  /** @type {HTMLVideoElement} */
  #videoEl;

  /** @type {function(ImageBitmap, number): Promise<void> | void} */
  #onFrame;

  /** @type {number} Target frame interval in ms (1000 / targetFps). */
  #frameInterval;

  /** @type {number | null} Current RAF handle. */
  #rafHandle = null;

  /** @type {boolean} */
  #isRunning = false;

  /** @type {number} Timestamp of last processed frame (ms). */
  #lastFrameTime = 0;

  /** @type {number} Number of in-flight async frame processors. */
  #inflightCount = 0;

  // FPS tracking
  /** @type {number} Frame count within the current FPS window. */
  #frameCount = 0;
  /** @type {number} Start of the current FPS measurement window (ms). */
  #fpsWindowStart = 0;
  /** @type {number} Last measured FPS value. */
  #measuredFps = 0;
  /** @type {number} Total frames captured since start. */
  #totalFrames = 0;
  /** @type {number} Total frames skipped (due to rate limiting or in-flight cap). */
  #skippedFrames = 0;

  /**
   * @param {HTMLVideoElement} videoEl - The live camera video element.
   * @param {function(ImageBitmap, number): Promise<void> | void} onFrame
   *   Callback invoked with each captured ImageBitmap and its timestamp.
   *   The callback is responsible for closing the ImageBitmap when done.
   * @param {number} [targetFps=30] - Target frame rate.
   */
  constructor(videoEl, onFrame, targetFps = DEFAULT_TARGET_FPS) {
    if (!(videoEl instanceof HTMLVideoElement)) {
      throw new TypeError('FrameCapture: videoEl must be an HTMLVideoElement');
    }
    if (typeof onFrame !== 'function') {
      throw new TypeError('FrameCapture: onFrame must be a function');
    }
    if (targetFps <= 0 || targetFps > 120) {
      throw new RangeError(`FrameCapture: targetFps must be 1–120, got ${targetFps}`);
    }

    this.#videoEl       = videoEl;
    this.#onFrame       = onFrame;
    this.#frameInterval = 1000 / targetFps;

    log.debug(`FrameCapture created — target ${targetFps}fps (interval: ${this.#frameInterval.toFixed(1)}ms)`);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Starts the frame capture loop.
   * Safe to call if already running — idempotent.
   *
   * @returns {void}
   */
  start() {
    if (this.#isRunning) {
      log.debug('FrameCapture already running');
      return;
    }

    if (!this.#isVideoReady()) {
      log.warn('FrameCapture.start() called before video is ready — waiting for canplay');
      this.#videoEl.addEventListener('canplay', () => this.start(), { once: true });
      return;
    }

    this.#isRunning      = true;
    this.#lastFrameTime  = 0;
    this.#frameCount     = 0;
    this.#fpsWindowStart = performance.now();
    this.#totalFrames    = 0;
    this.#skippedFrames  = 0;

    // Use setTimeout instead of requestAnimationFrame because RAF is suspended in offscreen documents!
    this.#rafHandle = setTimeout(() => this.#loop(performance.now()), this.#frameInterval);
    log.info('FrameCapture started');
  }

  /**
   * Stops the frame capture loop and cancels any pending timer.
   * Safe to call if already stopped — idempotent.
   *
   * @returns {void}
   */
  stop() {
    if (!this.#isRunning) return;

    this.#isRunning = false;
    if (this.#rafHandle !== null) {
      clearTimeout(this.#rafHandle);
      this.#rafHandle = null;
    }

    log.info(`FrameCapture stopped — ${this.#totalFrames} total frames, ${this.#skippedFrames} skipped`);
  }

  /**
   * Updates the target FPS on the fly without restarting the loop.
   * Useful for power-saving modes (reduce to 15fps when tab is hidden).
   *
   * @param {number} fps
   */
  setTargetFps(fps) {
    if (fps <= 0 || fps > 120) throw new RangeError(`Invalid fps: ${fps}`);
    this.#frameInterval = 1000 / fps;
    log.debug(`Target FPS updated to ${fps}`);
  }

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  /** @returns {boolean} */
  get isRunning()    { return this.#isRunning; }

  /** @returns {number} Last measured frames per second. */
  get measuredFps()  { return this.#measuredFps; }

  /** @returns {number} Total frames captured since last start. */
  get totalFrames()  { return this.#totalFrames; }

  /** @returns {number} Total frames skipped due to rate limiting. */
  get skippedFrames(){ return this.#skippedFrames; }

  // -------------------------------------------------------------------------
  // Private — RAF loop
  // -------------------------------------------------------------------------

  /**
   * Core requestAnimationFrame loop.
   * Enforces target FPS and in-flight frame limits before dispatching capture.
   *
   * @param {number} timestamp - High-resolution timestamp from RAF.
   */
  async #loop(timestamp) {
    if (!this.#isRunning) return;

    // Schedule the next frame immediately so we don't lose a tick
    this.#rafHandle = setTimeout(() => this.#loop(performance.now()), this.#frameInterval);

    // --- Rate limiting ---
    const elapsed = timestamp - this.#lastFrameTime;
    if (elapsed < this.#frameInterval) {
      // Not enough time has passed — skip this RAF tick
      return;
    }

    // --- In-flight cap: prevent pipeline back-pressure ---
    if (this.#inflightCount >= MAX_INFLIGHT_FRAMES) {
      this.#skippedFrames++;
      return;
    }

    // --- Video readiness guard ---
    if (!this.#isVideoReady()) {
      return;
    }

    // --- Capture frame ---
    this.#lastFrameTime = timestamp;
    this.#frameCount++;
    this.#totalFrames++;
    this.#inflightCount++;

    // Use createImageBitmap for zero-copy GPU transfer (Chrome-optimized path)
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(this.#videoEl);
    } catch (err) {
      // Video may have ended or been replaced; not fatal
      log.warn('createImageBitmap failed', err.message);
      this.#inflightCount--;
      return;
    }

    // --- Dispatch to consumer ---
    try {
      await this.#onFrame(bitmap, timestamp);
    } catch (err) {
      log.error('onFrame callback threw', err);
      // Always close bitmap even if consumer throws
      bitmap.close();
    } finally {
      this.#inflightCount--;
    }

    // --- FPS tracking ---
    this.#updateFpsMetrics(timestamp);
  }

  // -------------------------------------------------------------------------
  // Private — helpers
  // -------------------------------------------------------------------------

  /**
   * Returns true if the video element has enough data to be captured.
   * readyState >= HAVE_CURRENT_DATA (2) means at least one frame is available.
   *
   * @returns {boolean}
   */
  #isVideoReady() {
    return (
      this.#videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      this.#videoEl.videoWidth  > 0 &&
      this.#videoEl.videoHeight > 0 &&
      !this.#videoEl.paused     &&
      !this.#videoEl.ended
    );
  }

  /**
   * Updates FPS metrics and logs periodically.
   * @param {number} now - Current high-resolution timestamp.
   */
  #updateFpsMetrics(now) {
    const windowMs = now - this.#fpsWindowStart;
    if (windowMs >= FPS_LOG_INTERVAL_MS) {
      this.#measuredFps    = Math.round((this.#frameCount / windowMs) * 1000);
      this.#fpsWindowStart = now;
      this.#frameCount     = 0;
      log.debug(
        `FPS: ${this.#measuredFps} | Total: ${this.#totalFrames} | Skipped: ${this.#skippedFrames} | In-flight: ${this.#inflightCount}`
      );
    }
  }
}
