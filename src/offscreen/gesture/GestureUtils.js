/**
 * @fileoverview Gesture X — Shared Landmark Math Utilities
 *
 * Pure math helpers used by every gesture definition.
 * No imports, no side effects — fully tree-shakeable.
 *
 * MediaPipe Hands delivers 21 normalized landmarks per hand.
 * Each landmark: { x: 0..1, y: 0..1, z: depth (negative = closer to camera) }
 * Coordinate origin: top-left of video frame.
 *
 * Landmark index reference:
 *   0  = WRIST
 *   1–4  = THUMB  (CMC, MCP, IP, TIP)
 *   5–8  = INDEX  (MCP, PIP, DIP, TIP)
 *   9–12 = MIDDLE (MCP, PIP, DIP, TIP)
 *  13–16 = RING   (MCP, PIP, DIP, TIP)
 *  17–20 = PINKY  (MCP, PIP, DIP, TIP)
 */

// ---------------------------------------------------------------------------
// Landmark index constants
// ---------------------------------------------------------------------------

/** @enum {number} MediaPipe Hands landmark indices. */
export const LM = Object.freeze({
  WRIST:       0,
  THUMB_CMC:   1, THUMB_MCP:   2, THUMB_IP:    3, THUMB_TIP:   4,
  INDEX_MCP:   5, INDEX_PIP:   6, INDEX_DIP:   7, INDEX_TIP:   8,
  MIDDLE_MCP:  9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP:   13, RING_PIP:   14, RING_DIP:   15, RING_TIP:   16,
  PINKY_MCP:  17, PINKY_PIP:  18, PINKY_DIP:  19, PINKY_TIP:  20,
});

// Finger joint index groups: [mcp, pip, dip, tip]
const FINGER_JOINTS = [
  [LM.THUMB_CMC,  LM.THUMB_MCP,  LM.THUMB_IP,   LM.THUMB_TIP  ],
  [LM.INDEX_MCP,  LM.INDEX_PIP,  LM.INDEX_DIP,  LM.INDEX_TIP  ],
  [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP ],
  [LM.RING_MCP,   LM.RING_PIP,   LM.RING_DIP,   LM.RING_TIP   ],
  [LM.PINKY_MCP,  LM.PINKY_PIP,  LM.PINKY_DIP,  LM.PINKY_TIP  ],
];

// ---------------------------------------------------------------------------
// Distance & geometry
// ---------------------------------------------------------------------------

/**
 * Euclidean distance between two 2D landmarks.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Euclidean distance in 3D (x, y, z).
 * @param {{ x: number, y: number, z: number }} a
 * @param {{ x: number, y: number, z: number }} b
 * @returns {number}
 */
export function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Angle (radians) at vertex B in the triangle A-B-C.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b - Vertex.
 * @param {{ x: number, y: number }} c
 * @returns {number} Angle in radians [0, π].
 */
export function angleBetween(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBa = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const magBc = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
  if (magBa === 0 || magBc === 0) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot / (magBa * magBc))));
}

// ---------------------------------------------------------------------------
// Palm geometry
// ---------------------------------------------------------------------------

/**
 * Computes the palm center as the centroid of key base knuckles.
 * @param {Array<{x:number, y:number}>} lm - 21 landmarks.
 * @returns {{ x: number, y: number }}
 */
export function getPalmCenter(lm) {
  const keys = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  const x = keys.reduce((s, i) => s + lm[i].x, 0) / keys.length;
  const y = keys.reduce((s, i) => s + lm[i].y, 0) / keys.length;
  return { x, y };
}

/**
 * Approximates the hand/palm size as the wrist→middle-MCP distance.
 * Used to normalize other distance measurements to the hand scale.
 * @param {Array<{x:number, y:number}>} lm
 * @returns {number}
 */
export function getPalmScale(lm) {
  return distance(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 0.15; // fallback to ~15% of frame
}

// ---------------------------------------------------------------------------
// Finger state detection
// ---------------------------------------------------------------------------

/**
 * Returns the extension state for all 5 fingers.
 *
 * Algorithm:
 *  - For the 4 non-thumb fingers: extended if tip.y < pip.y
 *    (tip is above its first knuckle in image space — reliable for upright hands).
 *  - For the thumb: extended if the tip is far from the index MCP base,
 *    disambiguated by handedness to handle left/right mirror.
 *
 * @param {Array<{x:number, y:number}>} lm - 21 landmarks.
 * @param {'Left'|'Right'} handedness
 * @returns {boolean[]} [thumb, index, middle, ring, pinky] — true = extended.
 */
export function getFingerStates(lm, handedness) {
  const states = [];

  // --- Thumb ---
  // The thumb is extended if the tip is significantly further from the palm center than the IP joint.
  // Using a 1.2x multiplier ensures a relaxed thumb (which naturally rests outward) isn't falsely marked as extended.
  const palm = getPalmCenter(lm);
  const thumbTip = lm[LM.THUMB_TIP];
  const thumbIp  = lm[LM.THUMB_IP];
  const thumbExtended = distance3D(palm, thumbTip) > distance3D(palm, thumbIp) * 1.2;
  states.push(thumbExtended);

  // --- 4 fingers (index → pinky) ---
  for (let f = 1; f <= 4; f++) {
    const [mcpIdx, pipIdx, , tipIdx] = FINGER_JOINTS[f];
    // A finger is actively extended if the distance from its base (MCP) to its tip
    // is at least 1.3x the distance from its base to its middle knuckle (PIP).
    // This requires the finger to be straight. A relaxed, curved hand will fail this check,
    // preventing "ghost" inputs when the user is just sitting there.
    states.push(distance3D(lm[mcpIdx], lm[tipIdx]) > distance3D(lm[mcpIdx], lm[pipIdx]) * 1.3);
  }

  return states; // [thumb, index, middle, ring, pinky]
}

/**
 * Convenience: count of currently extended fingers.
 * @param {boolean[]} states - Output of getFingerStates.
 * @returns {number}
 */
export function countExtended(states) {
  return states.filter(Boolean).length;
}

/**
 * Checks if the hand matches a specific extension pattern.
 * @param {boolean[]} actual - getFingerStates result.
 * @param {(boolean|null)[]} pattern - Expected pattern; null = don't care.
 * @returns {boolean}
 */
export function matchesPattern(actual, pattern) {
  return pattern.every((expected, i) => expected === null || expected === actual[i]);
}
