/**
 * @fileoverview Gesture X — GestureDebouncer
 *
 * Temporal smoothing layer between the raw classifier output and the
 * confirmed gesture event that gets sent to the service worker.
 *
 * Problems it solves:
 *  1. False positives from a single misclassified frame.
 *  2. Gesture spam — rapid-fire repeats of the same gesture.
 *  3. Oscillation — flickering between two similar gestures.
 *
 * Algorithm:
 *  - A gesture must be continuously detected for at least `holdDuration` ms
 *    before being "confirmed" (hold-to-confirm debounce).
 *  - After a gesture is confirmed, a `cooldownMs` lockout period prevents
 *    any gesture from being confirmed again — even a different one.
 *  - Confidence is averaged over the hold window.
 */

import { createLogger } from '../../shared/Logger.js';

const log = createLogger('GestureDebouncer');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GestureCandidate
 * @property {string} label       - GestureLabel enum value.
 * @property {number} confidence  - 0–1.
 * @property {number} firstSeenMs - performance.now() when this candidate started.
 * @property {number[]} confidences - Rolling window of confidence samples.
 */

/**
 * @typedef {Object} ConfirmedGesture
 * @property {string} label       - GestureLabel enum value.
 * @property {number} confidence  - Averaged confidence over the hold window.
 * @property {string} hand        - 'Left' | 'Right'.
 * @property {number} timestamp   - Date.now() when confirmed.
 */

// ---------------------------------------------------------------------------
// GestureDebouncer
// ---------------------------------------------------------------------------

export class GestureDebouncer {
  /** @type {number} ms a gesture must be held before confirming. */
  #holdDuration;

  /** @type {number} ms to block any new gesture after a confirmation. */
  #cooldownMs;

  /** @type {GestureCandidate | null} Current candidate being tracked. */
  #candidate = null;

  /** @type {number} performance.now() when the last cooldown started. */
  #cooldownStart = -Infinity;

  /** @type {function(ConfirmedGesture): void} Callback when gesture is confirmed. */
  #onConfirmed;

  /**
   * @param {object} options
   * @param {number} options.holdDuration - ms to hold (default 300).
   * @param {number} options.cooldownMs  - ms cooldown between gestures (default 800).
   * @param {function(ConfirmedGesture): void} options.onConfirmed - Fired on confirmation.
   */
  constructor({ holdDuration = 300, cooldownMs = 800, onConfirmed }) {
    if (typeof onConfirmed !== 'function') {
      throw new TypeError('GestureDebouncer requires an onConfirmed callback');
    }
    this.#holdDuration = holdDuration;
    this.#cooldownMs   = cooldownMs;
    this.#onConfirmed  = onConfirmed;
    log.debug(`Debouncer: hold=${holdDuration}ms, cooldown=${cooldownMs}ms`);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Called every frame with the classifier's output.
   * Pass `null` when no gesture was detected to reset the candidate.
   *
   * @param {{ label: string, confidence: number } | null} result
   * @param {string} hand - 'Left' | 'Right'.
   * @param {number} now  - performance.now() timestamp.
   */
  update(result, hand, now) {
    // ---- Cooldown guard: ignore all gestures during lockout ----
    if (now - this.#cooldownStart < this.#cooldownMs) {
      return;
    }

    // ---- No gesture detected this frame ----
    if (!result || !result.label) {
      this.#resetCandidate();
      return;
    }

    const { label, confidence } = result;

    // ---- Different gesture than current candidate: reset and start fresh ----
    if (this.#candidate && this.#candidate.label !== label) {
      this.#resetCandidate();
    }

    // ---- Start or continue tracking the candidate ----
    if (!this.#candidate) {
      this.#candidate = {
        label,
        confidence,
        firstSeenMs: now,
        confidences: [confidence],
      };
      log.debug(`Candidate started: ${label} (${(confidence * 100).toFixed(0)}%)`);
      
      // Dynamic swipe gestures are transient events and cannot be "held".
      // Since velocity is already smoothed by VelocityTracker over several frames,
      // it is safe to confirm them immediately to prevent long holdDurations from blocking them.
      if (label.startsWith('SWIPE_')) {
        this.#confirm(hand, now);
      }
      return;
    }

    // Accumulate confidence samples
    this.#candidate.confidences.push(confidence);
    if (this.#candidate.confidences.length > 15) {
      this.#candidate.confidences.shift(); // keep last 15 samples
    }

    // ---- Hold duration check ----
    const held = now - this.#candidate.firstSeenMs;
    if (held >= this.#holdDuration) {
      this.#confirm(hand, now);
    }
  }

  /**
   * Updates configuration without recreating the instance.
   * Safe to call while the debouncer is actively running.
   *
   * @param {number} holdDuration
   * @param {number} cooldownMs
   */
  updateConfig(holdDuration, cooldownMs) {
    this.#holdDuration = holdDuration;
    this.#cooldownMs   = cooldownMs;
  }

  /** Resets the candidate immediately (e.g., when Gesture X is deactivated). */
  reset() {
    this.#resetCandidate();
    this.#cooldownStart = -Infinity;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /** Fires the confirmed event and starts the cooldown lockout. */
  #confirm(hand, now) {
    if (!this.#candidate) return;

    const avgConfidence =
      this.#candidate.confidences.reduce((a, b) => a + b, 0) /
      this.#candidate.confidences.length;

    /** @type {ConfirmedGesture} */
    const event = {
      label:      this.#candidate.label,
      confidence: Math.min(1, avgConfidence),
      hand,
      timestamp:  Date.now(),
    };

    log.info(`✅ Confirmed: ${event.label} (${(event.confidence * 100).toFixed(0)}%) — ${hand} hand`);

    this.#cooldownStart = now;
    this.#resetCandidate();

    // Fire callback (async errors are intentionally NOT caught here —
    // the caller is responsible for error handling)
    try {
      this.#onConfirmed(event);
    } catch (err) {
      log.error('onConfirmed callback threw', err);
    }
  }

  /** Clears the current candidate. */
  #resetCandidate() {
    if (this.#candidate) {
      log.debug(`Candidate reset: ${this.#candidate.label}`);
    }
    this.#candidate = null;
  }
}
