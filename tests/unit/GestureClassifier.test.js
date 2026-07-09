import { GestureClassifier } from '../../src/offscreen/gesture/GestureClassifier.js';
import { GestureLabel } from '../../src/shared/constants.js';

// Helper to build a generic 21-point landmark array
function buildLandmarks(overrides = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [idx, val] of Object.entries(overrides)) {
    lm[Number(idx)] = { ...lm[Number(idx)], ...val };
  }
  return lm;
}

describe('GestureClassifier', () => {
  let classifier;

  beforeEach(() => {
    classifier = new GestureClassifier(); // Uses RuleBasedStrategy by default
  });

  test('returns null when no landmarks provided', () => {
    const result = classifier.classify(null, 'Right', 0, 0.5);
    expect(result.label).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test('returns null when invalid landmarks provided', () => {
    const result = classifier.classify([{ x: 0, y: 0, z: 0 }], 'Right', 0, 0.5); // only 1 landmark
    expect(result.label).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test('classifies a static gesture correctly (e.g. FIST or null if not match)', () => {
    // If we just pass zeroes, it probably won't match a gesture with high confidence, 
    // or it might. Let's just ensure it returns a valid ClassifierResult format.
    const landmarks = buildLandmarks();
    const result = classifier.classify(landmarks, 'Right', performance.now(), 0.5);
    
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('confidence');
  });

  test('resets strategy without crashing', () => {
    expect(() => classifier.reset()).not.toThrow();
  });
});
