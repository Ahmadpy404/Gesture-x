/**
 * Swipe Left — rapid palm movement to the left.
 * Requires: horizontal velocity dominant and moving left.
 * Hand shape: any (open palm preferred for clean detection).
 */
import { getPalmCenter } from '../GestureUtils.js';

const BASE_THRESHOLD = 0.55; // normalized units per second

/**
 * @param {object[]} lm
 * @param {string} _handedness
 * @param {{ dx: number, dy: number, speed: number }} velocity
 * @param {number} sensitivity
 * @returns {{ detected: boolean, confidence: number }}
 */
export function detect(lm, _handedness, velocity, sensitivity) {
  const threshold = BASE_THRESHOLD * (1.6 - sensitivity); // harder at low sensitivity
  const isMovingLeft    = velocity.dx < -threshold;
  const isHorizontal    = Math.abs(velocity.dx) > Math.abs(velocity.dy) * 1.4;

  if (!isMovingLeft || !isHorizontal) return { detected: false, confidence: 0 };

  const confidence = Math.min(1, Math.abs(velocity.dx) / (threshold * 2));
  return { detected: true, confidence };
}
