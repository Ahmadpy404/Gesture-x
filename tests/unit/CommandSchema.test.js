import { validateMessage, assertValidMessage } from '../../src/shared/CommandSchema.js';
import { MessageType, GestureLabel, CommandId, ComponentId } from '../../src/shared/constants.js';

describe('CommandSchema', () => {
  describe('validateMessage', () => {
    test('rejects non-object messages', () => {
      expect(validateMessage(null).valid).toBe(false);
      expect(validateMessage('string').valid).toBe(false);
      expect(validateMessage(123).valid).toBe(false);
    });

    test('rejects unknown message types', () => {
      expect(validateMessage({ type: 'UNKNOWN_TYPE', source: ComponentId.POPUP, timestamp: Date.now() }).valid).toBe(false);
    });

    test('rejects unknown source component', () => {
      expect(validateMessage({ type: MessageType.GET_STATUS, source: 'UNKNOWN_SOURCE', timestamp: Date.now() }).valid).toBe(false);
    });

    test('rejects missing or invalid timestamp', () => {
      expect(validateMessage({ type: MessageType.GET_STATUS, source: ComponentId.POPUP }).valid).toBe(false); // missing
      expect(validateMessage({ type: MessageType.GET_STATUS, source: ComponentId.POPUP, timestamp: '123' }).valid).toBe(false); // string
      expect(validateMessage({ type: MessageType.GET_STATUS, source: ComponentId.POPUP, timestamp: -1 }).valid).toBe(false); // negative
    });

    test('validates GESTURE_CONFIRMED payload correctly', () => {
      const validMsg = {
        type: MessageType.GESTURE_CONFIRMED,
        source: ComponentId.OFFSCREEN,
        timestamp: Date.now(),
        payload: {
          label: GestureLabel.SWIPE_LEFT,
          confidence: 0.9,
          timestamp: Date.now(),
          hand: 'Right'
        }
      };
      expect(validateMessage(validMsg).valid).toBe(true);

      const invalidMsg = { ...validMsg, payload: { ...validMsg.payload, confidence: 1.5 } };
      expect(validateMessage(invalidMsg).valid).toBe(false); // confidence out of bounds
    });

    test('validates VOICE_COMMAND payload correctly', () => {
      const validMsg = {
        type: MessageType.VOICE_COMMAND,
        source: ComponentId.OFFSCREEN,
        timestamp: Date.now(),
        payload: {
          command: CommandId.SCROLL_DOWN,
          transcript: 'scroll down',
          confidence: 0.8
        }
      };
      expect(validateMessage(validMsg).valid).toBe(true);
    });

    test('validates simple message types with null payload', () => {
      const validMsg = {
        type: MessageType.GET_STATUS,
        source: ComponentId.POPUP,
        timestamp: Date.now(),
        payload: null
      };
      expect(validateMessage(validMsg).valid).toBe(true);
    });
  });

  describe('assertValidMessage', () => {
    test('does not throw for valid messages', () => {
      const validMsg = {
        type: MessageType.GET_STATUS,
        source: ComponentId.POPUP,
        timestamp: Date.now(),
        payload: null
      };
      expect(() => assertValidMessage(validMsg)).not.toThrow();
    });

    test('throws for invalid messages', () => {
      const invalidMsg = {
        type: 'INVALID',
        source: ComponentId.POPUP,
        timestamp: Date.now()
      };
      expect(() => assertValidMessage(invalidMsg)).toThrow('Invalid message');
    });
  });
});
