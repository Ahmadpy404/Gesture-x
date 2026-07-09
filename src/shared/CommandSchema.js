/**
 * @fileoverview Command schema validator for Gesture X.
 * All messages passing through the bus are validated against this schema
 * before being processed. Prevents XSS / injection via malformed messages.
 */

import { MessageType, GestureLabel, CommandId, ComponentId } from './constants.js';
import { createLogger } from './Logger.js';

const log = createLogger('CommandSchema');

// ---------------------------------------------------------------------------
// Validation sets
// ---------------------------------------------------------------------------

const VALID_MESSAGE_TYPES = new Set(Object.values(MessageType));
const VALID_GESTURE_LABELS = new Set(Object.values(GestureLabel));
const VALID_COMMAND_IDS    = new Set(Object.values(CommandId));
const VALID_COMPONENT_IDS  = new Set(Object.values(ComponentId));

// ---------------------------------------------------------------------------
// Primitive validators
// ---------------------------------------------------------------------------

const is = {
  string:  (v) => typeof v === 'string',
  number:  (v) => typeof v === 'number' && isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  object:  (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  null:    (v) => v === null,
};

// ---------------------------------------------------------------------------
// Payload validators per message type
// ---------------------------------------------------------------------------

/**
 * @type {Record<string, function(unknown): boolean>}
 */
const PAYLOAD_VALIDATORS = {
  [MessageType.GESTURE_CONFIRMED]: (p) =>
    is.object(p) &&
    VALID_GESTURE_LABELS.has(p.label) &&
    is.number(p.confidence) &&
    p.confidence >= 0 && p.confidence <= 1 &&
    is.number(p.timestamp) &&
    (p.hand === 'Left' || p.hand === 'Right'),

  [MessageType.VOICE_COMMAND]: (p) =>
    is.object(p) &&
    VALID_COMMAND_IDS.has(p.command) &&
    is.string(p.transcript) &&
    is.number(p.confidence),

  [MessageType.EXECUTE_SCROLL]: (p) =>
    is.object(p) &&
    ['up', 'down', 'top', 'bottom'].includes(p.direction) &&
    is.number(p.amount),

  [MessageType.SHOW_HUD]: (p) =>
    is.object(p) &&
    is.string(p.text) &&
    p.text.length <= 128 && // prevent oversized injections
    ['gesture', 'voice', 'system', 'error'].includes(p.type),

  [MessageType.HIDE_HUD]: (p) => p === null || is.object(p),

  [MessageType.STATUS_UPDATE]: (p) =>
    is.object(p) &&
    is.boolean(p.isActive),

  [MessageType.TOGGLE_ACTIVE]:  (p) => is.object(p) && is.boolean(p.active),
  [MessageType.TOGGLE_GESTURE]: (p) => is.object(p) && is.boolean(p.enabled),
  [MessageType.TOGGLE_VOICE]:   (p) => is.object(p) && is.boolean(p.enabled),

  [MessageType.GET_STATUS]:  (p) => p === null || is.object(p),
  [MessageType.GET_SETTINGS]: (p) => p === null || is.object(p),

  [MessageType.SETTINGS_CHANGED]: (p) =>
    is.object(p) &&
    is.string(p.key) &&
    'value' in p,

  [MessageType.OFFSCREEN_READY]: (p) => p === null || is.object(p),
  [MessageType.OFFSCREEN_ERROR]: (p) =>
    is.object(p) && is.string(p.error),

  [MessageType.SW_HEARTBEAT]:  (p) => is.object(p) && is.number(p.timestamp),
  [MessageType.START_CAMERA]:  (p) => p === null || is.object(p),
  [MessageType.STOP_CAMERA]:   (p) => p === null || is.object(p),
  [MessageType.START_SPEECH]:  (p) => p === null || is.object(p),
  [MessageType.STOP_SPEECH]:   (p) => p === null || is.object(p),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates a message envelope before processing.
 * Checks: type, source, timestamp, and payload shape.
 *
 * @param {unknown} message - Raw message from chrome.runtime.onMessage.
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateMessage(message) {
  if (!is.object(message)) {
    return { valid: false, reason: 'Message is not an object' };
  }

  if (!is.string(message.type) || !VALID_MESSAGE_TYPES.has(message.type)) {
    return { valid: false, reason: `Unknown message type: "${message.type}"` };
  }

  if (!is.string(message.source) || !VALID_COMPONENT_IDS.has(message.source)) {
    return { valid: false, reason: `Unknown source component: "${message.source}"` };
  }

  if (!is.number(message.timestamp) || message.timestamp <= 0) {
    return { valid: false, reason: 'Missing or invalid timestamp' };
  }

  const payloadValidator = PAYLOAD_VALIDATORS[message.type];
  if (payloadValidator && !payloadValidator(message.payload)) {
    return { valid: false, reason: `Invalid payload for message type "${message.type}"` };
  }

  return { valid: true };
}

/**
 * Validates and throws if invalid. Use in contexts where invalid messages
 * should hard-fail (e.g., in the command router).
 *
 * @param {unknown} message
 * @throws {Error} If message is invalid.
 */
export function assertValidMessage(message) {
  const { valid, reason } = validateMessage(message);
  if (!valid) {
    log.warn('Message validation failed', { reason, message });
    throw new Error(`Invalid message: ${reason}`);
  }
}
