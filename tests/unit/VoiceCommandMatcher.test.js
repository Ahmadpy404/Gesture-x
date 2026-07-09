import { VoiceCommandMatcher } from '../../src/offscreen/voice/VoiceCommandMatcher.js';
import { CommandId } from '../../src/shared/constants.js';

describe('VoiceCommandMatcher', () => {
  let matcher;

  beforeEach(() => {
    matcher = new VoiceCommandMatcher();
  });

  test('returns null for empty or invalid input', () => {
    expect(matcher.match('')).toBeNull();
    expect(matcher.match(null)).toBeNull();
    expect(matcher.match(undefined)).toBeNull();
    expect(matcher.match(123)).toBeNull();
  });

  test('exact match returns highest confidence', () => {
    const result = matcher.match('scroll to the bottom');
    expect(result).not.toBeNull();
    expect(result.commandId).toBe(CommandId.SCROLL_BOTTOM);
    expect(result.matchType).toBe('exact');
    expect(result.confidence).toBe(1.0);
  });

  test('normalizes transcript correctly (case and punctuation)', () => {
    const result = matcher.match('  SCROLL... to THE botTom!  ');
    expect(result).not.toBeNull();
    expect(result.commandId).toBe(CommandId.SCROLL_BOTTOM);
    expect(result.matchType).toBe('exact'); // After normalization, it's exact
  });

  test('contains match when transcript starts with phrase', () => {
    const result = matcher.match('go back please and thank you');
    expect(result).not.toBeNull();
    expect(result.commandId).toBe(CommandId.NAV_BACK);
    expect(result.matchType).toBe('contains');
  });

  test('contains match when transcript includes phrase in middle', () => {
    const result = matcher.match('can you open new tab for me');
    expect(result).not.toBeNull();
    expect(result.commandId).toBe(CommandId.TAB_NEW);
    expect(result.matchType).toBe('contains');
  });

  test('fuzzy match correctly matches words out of order', () => {
    const result = matcher.match('bottom the to scroll');
    expect(result).not.toBeNull();
    expect(result.commandId).toBe(CommandId.SCROLL_BOTTOM);
    expect(result.matchType).toBe('fuzzy');
  });

  test('short phrase strictness avoids false positives', () => {
    // "reset" alone shouldn't match "zoom reset" (2 words).
    const result = matcher.match('this is a reset');
    expect(result).toBeNull(); // Shouldn't falsely match "zoom reset"
  });

  test('below minimum confidence returns null', () => {
    // A completely unrelated sentence
    const result = matcher.match('what is the weather like today');
    expect(result).toBeNull();
  });
});
