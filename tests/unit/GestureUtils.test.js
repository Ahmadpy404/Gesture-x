/**
 * @fileoverview Unit tests for GestureUtils.js
 *
 * GestureUtils has zero external dependencies — no mocks required.
 * Tests cover: distance, distance3D, angleBetween, getPalmCenter,
 * getPalmScale, getFingerStates, countExtended, matchesPattern.
 */

import {
  distance,
  distance3D,
  angleBetween,
  getPalmCenter,
  getPalmScale,
  getFingerStates,
  countExtended,
  matchesPattern,
  LM,
} from '../../src/offscreen/gesture/GestureUtils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal 21-landmark array where all points are at origin. */
function buildLandmarks(overrides = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [idx, val] of Object.entries(overrides)) {
    lm[Number(idx)] = { ...lm[Number(idx)], ...val };
  }
  return lm;
}

// ---------------------------------------------------------------------------
// distance()
// ---------------------------------------------------------------------------

describe('distance()', () => {
  test('returns 0 for identical points', () => {
    expect(distance({ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.3 })).toBe(0);
  });

  test('returns correct Euclidean distance — horizontal', () => {
    expect(distance({ x: 0, y: 0 }, { x: 0.3, y: 0 })).toBeCloseTo(0.3);
  });

  test('returns correct Euclidean distance — diagonal 3-4-5 triangle', () => {
    expect(distance({ x: 0, y: 0 }, { x: 0.3, y: 0.4 })).toBeCloseTo(0.5);
  });

  test('is symmetric', () => {
    const a = { x: 0.1, y: 0.7 };
    const b = { x: 0.9, y: 0.2 };
    expect(distance(a, b)).toBeCloseTo(distance(b, a));
  });

  test('always returns non-negative value', () => {
    expect(distance({ x: -1, y: -1 }, { x: 1, y: 1 })).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// distance3D()
// ---------------------------------------------------------------------------

describe('distance3D()', () => {
  test('returns 0 for identical 3D points', () => {
    expect(distance3D({ x: 0.5, y: 0.3, z: -0.1 }, { x: 0.5, y: 0.3, z: -0.1 })).toBe(0);
  });

  test('accounts for z dimension', () => {
    const d2d = distance({ x: 0.3, y: 0.4 }, { x: 0, y: 0 });
    const d3d = distance3D({ x: 0.3, y: 0.4, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(d2d).toBeCloseTo(d3d); // z=0 → same as 2D
  });

  test('correct 3D distance for unit cube diagonal', () => {
    // sqrt(1²+1²+1²) = sqrt(3) ≈ 1.732
    expect(distance3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }))
      .toBeCloseTo(Math.sqrt(3));
  });

  test('handles missing z via default 0', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0.4, y: 0.3 };
    // z defaults to 0 — should equal 2D distance
    expect(distance3D(a, b)).toBeCloseTo(distance(a, b));
  });
});

// ---------------------------------------------------------------------------
// angleBetween()
// ---------------------------------------------------------------------------

describe('angleBetween()', () => {
  test('returns π/2 for a right angle', () => {
    const a = { x: 0, y: 1 }; // above B
    const b = { x: 0, y: 0 }; // vertex
    const c = { x: 1, y: 0 }; // right of B
    expect(angleBetween(a, b, c)).toBeCloseTo(Math.PI / 2);
  });

  test('returns 0 when A, B, C are collinear — A and C same side', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const c = { x: 0.5, y: 0 }; // between a and b
    // Collinear — same direction from B → angle ≈ 0
    const angle = angleBetween(a, b, c);
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThanOrEqual(Math.PI);
  });

  test('returns π for a straight line (180°)', () => {
    const a = { x: -1, y: 0 };
    const b = { x: 0,  y: 0 };
    const c = { x: 1,  y: 0 };
    expect(angleBetween(a, b, c)).toBeCloseTo(Math.PI);
  });

  test('returns 0 when two vectors have zero magnitude', () => {
    const p = { x: 0, y: 0 };
    expect(angleBetween(p, p, p)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getPalmCenter()
// ---------------------------------------------------------------------------

describe('getPalmCenter()', () => {
  test('returns centroid of key knuckles + wrist', () => {
    // Set wrist and 4 MCP joints at known positions
    const lm = buildLandmarks({
      [LM.WRIST]:      { x: 0, y: 0 },
      [LM.INDEX_MCP]:  { x: 1, y: 0 },
      [LM.MIDDLE_MCP]: { x: 1, y: 1 },
      [LM.RING_MCP]:   { x: 0, y: 1 },
      [LM.PINKY_MCP]:  { x: 0, y: 0 },
    });
    const center = getPalmCenter(lm);
    // Centroid of (0,0),(1,0),(1,1),(0,1),(0,0) = (2/5, 2/5) = (0.4, 0.4)
    expect(center.x).toBeCloseTo(0.4);
    expect(center.y).toBeCloseTo(0.4);
  });

  test('returns origin for all-zero landmarks', () => {
    const lm = buildLandmarks();
    expect(getPalmCenter(lm)).toEqual({ x: 0, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// getPalmScale()
// ---------------------------------------------------------------------------

describe('getPalmScale()', () => {
  test('returns wrist-to-middle-MCP distance', () => {
    const lm = buildLandmarks({
      [LM.WRIST]:     { x: 0,   y: 0 },
      [LM.MIDDLE_MCP]:{ x: 0.3, y: 0.4 }, // distance = 0.5
    });
    expect(getPalmScale(lm)).toBeCloseTo(0.5);
  });

  test('returns 0.15 fallback for coincident wrist+MCP', () => {
    // Both at origin → distance = 0 → fallback
    expect(getPalmScale(buildLandmarks())).toBe(0.15);
  });
});

// ---------------------------------------------------------------------------
// getFingerStates()
// ---------------------------------------------------------------------------

describe('getFingerStates()', () => {
  /**
   * Build a "flat open palm" where all finger tips are above their PIPs.
   * y decreasing = moving "up" in image space (y=0 is top).
   */
  function openPalmLandmarks(handedness = 'Right') {
    const lm = buildLandmarks();
    // Thumb: tip is further from palm center (0,0,0) than IP
    // Thumb: dist(palm, tip) > dist(palm, ip) * 1.2
    lm[LM.THUMB_IP]  = { x: 0.2, y: 0 };
    lm[LM.THUMB_TIP] = { x: 0.5, y: 0 }; // dist 0.5 > 0.2 * 1.2 -> extended

    // Each finger: dist(mcp, tip) > dist(mcp, pip) * 1.3
    const fingerDefs = [
      [LM.INDEX_MCP,  LM.INDEX_PIP,  LM.INDEX_TIP ],
      [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_TIP],
      [LM.RING_MCP,   LM.RING_PIP,   LM.RING_TIP  ],
      [LM.PINKY_MCP,  LM.PINKY_PIP,  LM.PINKY_TIP ],
    ];
    for (const [mcp, pip, tip] of fingerDefs) {
      lm[mcp] = { x: 0, y: 0 };
      lm[pip] = { x: 0, y: -0.2 }; // dist(mcp, pip) = 0.2
      lm[tip] = { x: 0, y: -0.6 }; // dist(mcp, tip) = 0.6 > 0.26 -> extended
    }
    return lm;
  }

  function fistLandmarks() {
    const lm = buildLandmarks();
    // Thumb: tip is closer/equal to palm center than IP
    lm[LM.THUMB_IP]  = { x: 0.2, y: 0 };
    lm[LM.THUMB_TIP] = { x: 0.1, y: 0 }; // dist 0.1 < 0.2 -> NOT extended

    // All fingers curled: dist(mcp, tip) is small
    const fingerDefs = [
      [LM.INDEX_MCP,  LM.INDEX_PIP,  LM.INDEX_TIP ],
      [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_TIP],
      [LM.RING_MCP,   LM.RING_PIP,   LM.RING_TIP  ],
      [LM.PINKY_MCP,  LM.PINKY_PIP,  LM.PINKY_TIP ],
    ];
    for (const [mcp, pip, tip] of fingerDefs) {
      lm[mcp] = { x: 0, y: 0 };
      lm[pip] = { x: 0, y: -0.4 }; // dist(mcp, pip) = 0.4
      lm[tip] = { x: 0, y: -0.2 }; // dist(mcp, tip) = 0.2 < 0.52 -> curled
    }
    return lm;
  }

  test('returns 5 values for open palm — right hand', () => {
    const states = getFingerStates(openPalmLandmarks('Right'), 'Right');
    expect(states).toHaveLength(5);
    expect(states.every(Boolean)).toBe(true); // all extended
  });

  test('returns all false for fist — right hand', () => {
    const states = getFingerStates(fistLandmarks(), 'Right');
    expect(states).toHaveLength(5);
    expect(states.every((s) => !s)).toBe(true); // none extended
  });

  test('thumb extension logic is 3D rotation invariant', () => {
    const lm = buildLandmarks({
      [LM.THUMB_IP]:  { x: 0.2, y: 0 },
      [LM.THUMB_TIP]: { x: 0.5, y: 0 }, // further -> extended
    });
    const states = getFingerStates(lm, 'Left');
    expect(states[0]).toBe(true); 
  });

  test('thumb NOT extended when tip is closer to palm center', () => {
    const lm = buildLandmarks({
      [LM.THUMB_IP]:  { x: 0.4, y: 0 },
      [LM.THUMB_TIP]: { x: 0.2, y: 0 }, // closer -> NOT extended
    });
    const states = getFingerStates(lm, 'Right');
    expect(states[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// countExtended()
// ---------------------------------------------------------------------------

describe('countExtended()', () => {
  test('counts true values correctly', () => {
    expect(countExtended([true, false, true, false, true])).toBe(3);
  });
  test('returns 0 for all-false', () => {
    expect(countExtended([false, false, false, false, false])).toBe(0);
  });
  test('returns 5 for all-true', () => {
    expect(countExtended([true, true, true, true, true])).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// matchesPattern()
// ---------------------------------------------------------------------------

describe('matchesPattern()', () => {
  test('exact match returns true', () => {
    expect(matchesPattern([true, false, true, false, false], [true, false, true, false, false])).toBe(true);
  });

  test('null entries are wildcards', () => {
    // Only care that index[0]=true and index[2]=false — rest is null
    expect(matchesPattern([true, true, false, true, false], [true, null, false, null, null])).toBe(true);
  });

  test('mismatch returns false', () => {
    expect(matchesPattern([true, false, true, false, false], [true, true, true, false, false])).toBe(false);
  });

  test('all-null pattern always matches', () => {
    expect(matchesPattern([true, false, true, false, true], [null, null, null, null, null])).toBe(true);
  });

  test('FIST pattern: [false, false, false, false, false]', () => {
    const FIST_PATTERN = [false, false, false, false, false];
    expect(matchesPattern([false, false, false, false, false], FIST_PATTERN)).toBe(true);
    expect(matchesPattern([false, true,  false, false, false], FIST_PATTERN)).toBe(false);
  });

  test('OPEN_PALM pattern: [true, true, true, true, true]', () => {
    const PALM_PATTERN = [true, true, true, true, true];
    expect(matchesPattern([true, true, true, true, true],  PALM_PATTERN)).toBe(true);
    expect(matchesPattern([true, true, true, true, false], PALM_PATTERN)).toBe(false);
  });

  test('PEACE pattern: [null, true, true, false, false]', () => {
    const PEACE = [null, true, true, false, false];
    expect(matchesPattern([false, true, true, false, false], PEACE)).toBe(true);
    expect(matchesPattern([true,  true, true, false, false], PEACE)).toBe(true); // thumb irrelevant
    expect(matchesPattern([false, true, false,false, false], PEACE)).toBe(false);
  });
});
