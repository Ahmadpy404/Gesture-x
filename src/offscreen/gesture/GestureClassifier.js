/**
 * @fileoverview Gesture X — GestureClassifier
 *
 * Converts raw MediaPipe landmarks into a named gesture label using
 * the Strategy pattern. V1 uses RuleBasedStrategy; a TFLiteStrategy
 * stub is provided for V2 drop-in replacement.
 *
 * Architecture:
 *   GestureClassifier (composition root)
 *     └── strategy: ClassifierStrategy
 *           ├── RuleBasedStrategy (V1)  ← active
 *           └── TFLiteStrategy    (V2)  ← stub, ready for plug-in
 *
 * The RuleBasedStrategy:
 *  - Maintains a VelocityTracker (palm position over time → dx/dy velocity).
 *  - Runs each gesture's `detect()` function in priority order.
 *  - Returns the first gesture that exceeds the confidence threshold.
 *  - Priority: static gestures first (Fist, OpenPalm, Peace…) then dynamic
 *    swipes (to avoid swipes triggering while making a static shape).
 */

import { GestureLabel } from '../../shared/constants.js';
import { getPalmCenter } from './GestureUtils.js';
import { createLogger } from '../../shared/Logger.js';

// We only need swipe detectors now, as static gestures come from ML
import { detect as detectSwipeLeft }  from './gestures/SwipeLeft.js';
import { detect as detectSwipeRight } from './gestures/SwipeRight.js';
import { detect as detectSwipeUp }    from './gestures/SwipeUp.js';
import { detect as detectSwipeDown }  from './gestures/SwipeDown.js';

const log = createLogger('GestureClassifier');

// ---------------------------------------------------------------------------
// VelocityTracker
// ---------------------------------------------------------------------------

/**
 * Tracks recent palm positions over time to derive dx/dy velocity.
 * Uses a fixed-size circular buffer.
 */
class VelocityTracker {
  /** @type {Array<{x:number, y:number, t:number}>} */
  #buffer = [];

  /** @type {number} Maximum samples to keep. */
  #maxSamples;

  /** @param {number} [maxSamples=12] */
  constructor(maxSamples = 12) {
    this.#maxSamples = maxSamples;
  }

  /**
   * Records a new palm position at the given timestamp.
   * @param {number} x
   * @param {number} y
   * @param {number} t - performance.now() timestamp.
   */
  push(x, y, t) {
    this.#buffer.push({ x, y, t });
    if (this.#buffer.length > this.#maxSamples) {
      this.#buffer.shift();
    }
  }

  /**
   * Returns velocity in normalized units per second.
   * @returns {{ dx: number, dy: number, speed: number }}
   */
  get velocity() {
    if (this.#buffer.length < 3) return { dx: 0, dy: 0, speed: 0 };

    const oldest = this.#buffer[0];
    const newest = this.#buffer[this.#buffer.length - 1];
    const dtSec  = (newest.t - oldest.t) / 1_000;

    if (dtSec <= 0.001) return { dx: 0, dy: 0, speed: 0 };

    const dx    = (newest.x - oldest.x) / dtSec;
    const dy    = (newest.y - oldest.y) / dtSec;
    const speed = Math.sqrt(dx * dx + dy * dy);
    return { dx, dy, speed };
  }

  /** Clears all buffered positions. */
  reset() {
    this.#buffer = [];
  }
}

// ---------------------------------------------------------------------------
// Classifier strategy interface
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ClassifierResult
 * @property {string|null} label      - GestureLabel or null if nothing detected.
 * @property {number}      confidence - 0–1.
 */

/**
 * @interface ClassifierStrategy
 * Implement this interface to swap classification backends.
 */

// ---------------------------------------------------------------------------
// RuleBasedStrategy — V1 implementation
// ---------------------------------------------------------------------------

class RuleBasedStrategy {
  /** @type {VelocityTracker} */
  #velocity = new VelocityTracker();

  /** @type {number} Minimum confidence to report a gesture. */
  #confidenceThreshold;

  /** @param {number} [confidenceThreshold=0.5] */
  constructor(confidenceThreshold = 0.5) {
    this.#confidenceThreshold = confidenceThreshold;
  }

  /**
   * Classifies a single set of landmarks using ML output and heuristics.
   *
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @param {'Left'|'Right'} handedness
   * @param {number} timestamp - performance.now().
   * @param {number} sensitivity - 0.1–1.0 from user settings.
   * @param {string} mlCategory - ML predicted category.
   * @param {number} mlScore - ML predicted confidence.
   * @returns {ClassifierResult}
   */
  classify(landmarks, handedness, timestamp, sensitivity, mlCategory, mlScore) {
    // Update velocity tracker with current palm position
    const palm = getPalmCenter(landmarks);
    this.#velocity.push(palm.x, palm.y, timestamp);
    const velocity = this.#velocity.velocity;

    // Rule evaluation order:
    // Swipe gestures require velocity. We evaluate them first because a fast swipe
    // might temporarily look like an Open_Palm to the ML model.
    const SWIPE_RULES = [
      { label: GestureLabel.SWIPE_LEFT,  fn: detectSwipeLeft  },
      { label: GestureLabel.SWIPE_RIGHT, fn: detectSwipeRight },
      { label: GestureLabel.SWIPE_UP,    fn: detectSwipeUp    },
      { label: GestureLabel.SWIPE_DOWN,  fn: detectSwipeDown  },
    ];

    for (const rule of SWIPE_RULES) {
      // Swipes still use heuristics
      const result = rule.fn(landmarks, handedness, velocity, sensitivity);
      if (result && result.detected && result.confidence >= this.#confidenceThreshold) {
        return { label: rule.label, confidence: result.confidence };
      }
    }

    // No swipe detected. Use ML category for static gestures.
    // Apply sensitivity modifier to threshold
    const threshold = this.#confidenceThreshold * (1.5 - sensitivity);
    
    if (mlScore >= threshold) {
      switch (mlCategory) {
        case 'Closed_Fist': return { label: GestureLabel.FIST,        confidence: mlScore };
        case 'Open_Palm':   return { label: GestureLabel.OPEN_PALM,   confidence: mlScore };
        case 'Victory':     return { label: GestureLabel.PEACE,       confidence: mlScore };
        case 'Thumb_Up':    return { label: GestureLabel.THUMBS_UP,   confidence: mlScore };
        case 'Thumb_Down':  return { label: GestureLabel.THUMBS_DOWN, confidence: mlScore };
        // 'Pinch' is no longer natively supported by the ML model
        default: break;
      }
    }

    return { label: null, confidence: 0 };
  }

  /** Resets velocity tracker (call when no hand is detected). */
  reset() {
    this.#velocity.reset();
  }
}

// ---------------------------------------------------------------------------
// TFLiteStrategy — V2 stub
// ---------------------------------------------------------------------------

/**
 * Stub strategy — replace body with TFLite inference when ready for V2.
 * The GestureClassifier does not need to change when this is activated.
 */
export class TFLiteStrategy {
  /**
   * @param {Array<{x:number,y:number,z:number}>} _landmarks
   * @param {string} _handedness
   * @param {number} _timestamp
   * @param {number} _sensitivity
   * @returns {ClassifierResult}
   */
  // eslint-disable-next-line no-unused-vars
  classify(_landmarks, _handedness, _timestamp, _sensitivity) {
    // V2: load tflite model, run inference, return label + confidence
    throw new Error('TFLiteStrategy is not implemented in V1. Use RuleBasedStrategy.');
  }

  reset() {}
}

// ---------------------------------------------------------------------------
// GestureClassifier — composition root
// ---------------------------------------------------------------------------

export class GestureClassifier {
  /** @type {RuleBasedStrategy | TFLiteStrategy} */
  #strategy;

  /**
   * @param {RuleBasedStrategy | TFLiteStrategy} [strategy]
   *   Defaults to RuleBasedStrategy. Pass TFLiteStrategy() to use V2 model.
   */
  constructor(strategy) {
    this.#strategy = strategy ?? new RuleBasedStrategy();
    log.info(`GestureClassifier using: ${this.#strategy.constructor.name}`);
  }

  /**
   * Classifies landmarks using the active strategy.
   *
   * @param {Array<{x:number,y:number,z:number}>} landmarks
   * @param {'Left'|'Right'} handedness
   * @param {number} timestamp - performance.now().
   * @param {number} sensitivity - 0.1–1.0.
   * @returns {ClassifierResult}
   */
  classify(landmarks, handedness, timestamp, sensitivity, mlCategory, mlScore) {
    if (!landmarks || landmarks.length !== 21) {
      return { label: null, confidence: 0 };
    }
    return this.#strategy.classify(landmarks, handedness, timestamp, sensitivity, mlCategory, mlScore);
  }

  /**
   * Resets the strategy's internal state (velocity buffer, etc.).
   * Call when no hand is detected for a frame.
   */
  reset() {
    this.#strategy.reset();
  }

  /**
   * Swaps the classification strategy at runtime.
   * Enables hot-switching between rule-based and TFLite without reloading.
   *
   * @param {RuleBasedStrategy | TFLiteStrategy} strategy
   */
  setStrategy(strategy) {
    this.#strategy = strategy;
    log.info(`Strategy switched to: ${strategy.constructor.name}`);
  }
}
