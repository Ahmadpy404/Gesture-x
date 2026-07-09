/**
 * Swipe Up — rapid palm movement upward (negative dy in image coords).
 * Requires: vertical velocity dominant and moving up.
 */
const BASE_THRESHOLD = 0.45;

/**
 * @param {object[]} lm
 * @param {string} _handedness
 * @param {{ dx: number, dy: number, speed: number }} velocity
 * @param {number} sensitivity
 * @returns {{ detected: boolean, confidence: number }}
 */
export function detect(lm, _handedness, velocity, sensitivity) {
  const threshold  = BASE_THRESHOLD * (1.6 - sensitivity);
  const isMovingUp = velocity.dy < -threshold;       // dy negative = moving up
  const isVertical = Math.abs(velocity.dy) > Math.abs(velocity.dx) * 1.0;

  if (!isMovingUp || !isVertical) return { detected: false, confidence: 0 };

  const confidence = Math.min(1, Math.abs(velocity.dy) / (threshold * 2));
  return { detected: true, confidence };
}
