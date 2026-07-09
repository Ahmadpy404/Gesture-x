/**
 * @fileoverview Gesture X — CameraManager
 * Manages the full lifecycle of the getUserMedia camera stream.
 *
 * Responsibilities:
 *  - Request camera access with optimal constraints for MediaPipe
 *  - Attach / detach stream to a video element
 *  - Handle all known permission and device errors with typed responses
 *  - Support graceful stop, pause, and resume without re-prompting the user
 *  - Expose current stream and video element for FrameCapture to consume
 *
 * Design note: This module has zero knowledge of gestures or commands.
 * It is purely concerned with the camera stream lifecycle.
 */

import { createLogger } from '../../shared/Logger.js';
import { GestureXError, ErrorType } from '../../shared/ErrorHandler.js';
import { ComponentId } from '../../shared/constants.js';

const log = createLogger('CameraManager');

// ---------------------------------------------------------------------------
// Camera constraints
// ---------------------------------------------------------------------------

/**
 * Preferred constraints for MediaPipe Hands (requires 640×480 at 30fps minimum).
 * Falls back gracefully if device doesn't support ideal values.
 *
 * @type {MediaStreamConstraints}
 */
const CAMERA_CONSTRAINTS = {
  video: {
    width:       { ideal: 640, min: 320 },
    height:      { ideal: 480, min: 240 },
    frameRate:   { ideal: 30,  min: 15  },
    facingMode:  'user',          // front camera for gesture recognition
    aspectRatio: { ideal: 1.333 }, // 4:3 — optimal for hand landmark detection
  },
  audio: false,
};

// ---------------------------------------------------------------------------
// CameraState enum
// ---------------------------------------------------------------------------

/** @enum {string} Possible states of the camera. */
export const CameraState = Object.freeze({
  IDLE:     'IDLE',
  STARTING: 'STARTING',
  ACTIVE:   'ACTIVE',
  PAUSED:   'PAUSED',
  STOPPING: 'STOPPING',
  ERROR:    'ERROR',
});

// ---------------------------------------------------------------------------
// CameraManager
// ---------------------------------------------------------------------------

export class CameraManager {
  /** @type {MediaStream | null} */
  #stream = null;

  /** @type {HTMLVideoElement | null} */
  #videoEl = null;

  /** @type {CameraState} */
  #state = CameraState.IDLE;

  /** @type {function(CameraState): void | null} */
  #onStateChange = null;

  /**
   * @param {HTMLVideoElement} videoEl - The video element to attach the stream to.
   * @param {function(CameraState): void} [onStateChange] - Callback when state changes.
   */
  constructor(videoEl, onStateChange) {
    if (!(videoEl instanceof HTMLVideoElement)) {
      throw new GestureXError(
        'CameraManager requires a valid HTMLVideoElement',
        ErrorType.CAMERA_ACCESS,
        ComponentId.OFFSCREEN
      );
    }
    this.#videoEl      = videoEl;
    this.#onStateChange = onStateChange ?? null;
    log.debug('CameraManager created');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Requests camera access and attaches the stream to the video element.
   * Safe to call multiple times — idempotent if already active.
   *
   * @returns {Promise<MediaStream>} The active camera stream.
   * @throws {GestureXError} If permission is denied or device unavailable.
   */
  async start() {
    if (this.#state === CameraState.ACTIVE) {
      log.debug('Camera already active — skipping start');
      return this.#stream;
    }

    if (this.#state === CameraState.STARTING) {
      log.debug('Camera already starting — waiting');
      // Wait until state changes from STARTING (via polling with timeout)
      return this.#waitForState(CameraState.ACTIVE, 10_000);
    }

    this.#setState(CameraState.STARTING);
    log.info('Requesting camera access...');

    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      this.#stream = stream;
      await this.#attachToVideo(stream);
      this.#setState(CameraState.ACTIVE);
      log.info(`Camera active — ${this.#describeTrack()}`);
      return stream;
    } catch (err) {
      this.#setState(CameraState.ERROR);
      throw this.#mapError(err);
    }
  }

  /**
   * Stops the camera stream and releases all tracks.
   * After calling this, `start()` will re-request camera permission if needed.
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.#state === CameraState.IDLE || this.#state === CameraState.STOPPING) {
      return;
    }

    this.#setState(CameraState.STOPPING);
    log.info('Stopping camera...');

    this.#detachFromVideo();
    this.#stopAllTracks();
    this.#stream = null;

    this.#setState(CameraState.IDLE);
    log.info('Camera stopped');
  }

  /**
   * Pauses video track without releasing the stream.
   * Useful for temporarily suspending frame capture without re-requesting permission.
   *
   * @returns {void}
   */
  pause() {
    if (this.#state !== CameraState.ACTIVE) return;
    this.#getVideoTrack()?.applyConstraints({ advanced: [{ frameRate: 1 }] });
    this.#setState(CameraState.PAUSED);
    log.debug('Camera paused');
  }

  /**
   * Resumes a paused camera by restoring original frame rate constraints.
   *
   * @returns {Promise<void>}
   */
  async resume() {
    if (this.#state !== CameraState.PAUSED) return;
    const track = this.#getVideoTrack();
    if (track) {
      await track.applyConstraints({ frameRate: { ideal: 30, min: 15 } });
    }
    this.#setState(CameraState.ACTIVE);
    log.debug('Camera resumed');
  }

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  /** @returns {MediaStream | null} The active stream, or null if not started. */
  get stream()   { return this.#stream; }

  /** @returns {HTMLVideoElement | null} The attached video element. */
  get videoEl()  { return this.#videoEl; }

  /** @returns {CameraState} Current camera state. */
  get state()    { return this.#state; }

  /** @returns {boolean} Whether the camera is currently streaming frames. */
  get isActive() { return this.#state === CameraState.ACTIVE; }

  /**
   * Returns the actual resolved capabilities of the active video track.
   * Returns null if camera is not active.
   *
   * @returns {MediaTrackSettings | null}
   */
  get trackSettings() {
    return this.#getVideoTrack()?.getSettings() ?? null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Attaches a MediaStream to the video element and waits for it to be ready.
   * @param {MediaStream} stream
   * @returns {Promise<void>}
   */
  #attachToVideo(stream) {
    return new Promise((resolve, reject) => {
      if (!this.#videoEl) {
        reject(new Error('Video element is null'));
        return;
      }

      this.#videoEl.srcObject = stream;

      const onCanPlay = () => {
        this.#videoEl.removeEventListener('canplay', onCanPlay);
        this.#videoEl.removeEventListener('error',   onError);
        resolve();
      };

      const onError = (ev) => {
        this.#videoEl.removeEventListener('canplay', onCanPlay);
        this.#videoEl.removeEventListener('error',   onError);
        reject(new Error(`Video element error: ${ev.message ?? 'unknown'}`));
      };

      this.#videoEl.addEventListener('canplay', onCanPlay, { once: true });
      this.#videoEl.addEventListener('error',   onError,   { once: true });

      // Kick off playback (autoplay attribute handles most cases)
      this.#videoEl.play().catch((err) => {
        // Ignore AbortError — happens when stop() is called before play() resolves
        if (err.name !== 'AbortError') {
          log.warn('video.play() rejected', err);
        }
      });
    });
  }

  /**
   * Detaches the stream from the video element without stopping tracks.
   */
  #detachFromVideo() {
    if (!this.#videoEl) return;
    this.#videoEl.pause();
    this.#videoEl.srcObject = null;
  }

  /**
   * Stops all tracks in the current stream to release the camera hardware.
   */
  #stopAllTracks() {
    if (!this.#stream) return;
    this.#stream.getTracks().forEach((track) => {
      track.stop();
      log.debug(`Track stopped: ${track.kind} — ${track.label}`);
    });
  }

  /**
   * Returns the first active video track from the stream.
   * @returns {MediaStreamTrack | null}
   */
  #getVideoTrack() {
    return this.#stream?.getVideoTracks()[0] ?? null;
  }

  /**
   * Returns a human-readable description of the active video track.
   * @returns {string}
   */
  #describeTrack() {
    const s = this.trackSettings;
    if (!s) return 'no track info';
    return `${s.width}×${s.height} @ ${s.frameRate?.toFixed(0)}fps — ${s.deviceId?.slice(0, 8)}...`;
  }

  /**
   * Updates the internal state and fires the onStateChange callback.
   * @param {CameraState} newState
   */
  #setState(newState) {
    if (this.#state === newState) return;
    log.debug(`CameraState: ${this.#state} → ${newState}`);
    this.#state = newState;
    this.#onStateChange?.(newState);
  }

  /**
   * Maps native getUserMedia errors to typed GestureXErrors.
   * @param {unknown} err - The caught error from getUserMedia.
   * @returns {GestureXError}
   */
  #mapError(err) {
    const name = err instanceof Error ? err.name : 'UnknownError';

    const errorMap = {
      NotAllowedError: {
        message:      'Camera permission denied by the user or browser policy.',
        recoveryHint: 'Open chrome://settings/content/camera and allow this extension.',
      },
      NotFoundError: {
        message:      'No camera device found on this machine.',
        recoveryHint: 'Connect a webcam and try again.',
      },
      NotReadableError: {
        message:      'Camera is already in use by another application.',
        recoveryHint: 'Close other apps using the camera and retry.',
      },
      OverconstrainedError: {
        message:      'Camera cannot satisfy the requested constraints (resolution/framerate).',
        recoveryHint: 'The device may not support 640×480 @ 30fps.',
      },
      SecurityError: {
        message:      'Camera access blocked by a security policy.',
        recoveryHint: 'Check extension permissions in chrome://extensions.',
      },
    };

    const mapped = errorMap[name] ?? {
      message:      `Unexpected camera error: ${err?.message ?? name}`,
      recoveryHint: 'Reload the extension and try again.',
    };

    log.error(mapped.message, { originalError: err });

    return new GestureXError(
      mapped.message,
      ErrorType.CAMERA_ACCESS,
      ComponentId.OFFSCREEN,
      err,
      mapped.recoveryHint
    );
  }

  /**
   * Waits until the camera reaches a target state (polling-based).
   * Used when two callers race to start the camera simultaneously.
   *
   * @param {CameraState} targetState
   * @param {number} timeoutMs
   * @returns {Promise<MediaStream>}
   */
  #waitForState(targetState, timeoutMs) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        if (this.#state === targetState) {
          resolve(this.#stream);
        } else if (this.#state === CameraState.ERROR || Date.now() > deadline) {
          reject(new GestureXError(
            `Camera did not reach ${targetState} within ${timeoutMs}ms`,
            ErrorType.CAMERA_ACCESS,
            ComponentId.OFFSCREEN
          ));
        } else {
          setTimeout(poll, 50);
        }
      };
      poll();
    });
  }
}
