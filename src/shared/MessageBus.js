/**
 * @fileoverview Typed message bus for Gesture X.
 * All inter-component communication routes through these helpers.
 * Enforces consistent message envelopes and provides request-response pairs.
 */

import { MessageType, ComponentId } from './constants.js';
import { createLogger } from './Logger.js';

const log = createLogger('MessageBus');

// ---------------------------------------------------------------------------
// Types (JSDoc only — no runtime cost)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Message
 * @property {string}  type       - MessageType enum value.
 * @property {unknown} payload    - Message-specific data.
 * @property {string}  source     - ComponentId of the sender.
 * @property {number}  timestamp  - Unix ms timestamp.
 * @property {string}  [requestId] - Present on request messages for response pairing.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a well-formed message envelope.
 * @param {string} type
 * @param {unknown} payload
 * @param {string} source
 * @param {string} [requestId]
 * @returns {Message}
 */
function buildMessage(type, payload, source, requestId) {
  return {
    type,
    payload:   payload ?? null,
    source,
    timestamp: Date.now(),
    ...(requestId ? { requestId } : {}),
  };
}

/**
 * Generates a unique request ID.
 * @returns {string}
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends a fire-and-forget message to the extension's runtime (service worker).
 * Safely swallows "no receiver" errors which occur when the SW is not yet ready.
 *
 * @param {string} type        - MessageType constant.
 * @param {unknown} payload    - Message payload.
 * @param {string} [source]    - Sender component ID.
 * @returns {Promise<void>}
 */
export async function sendToRuntime(type, payload, source = ComponentId.CONTENT) {
  const message = buildMessage(type, payload, source);
  try {
    await chrome.runtime.sendMessage(message);
  } catch (err) {
    // "Could not establish connection" is expected when SW is waking up.
    if (!err.message?.includes('Could not establish connection')) {
      log.warn('sendToRuntime failed', { type, error: err.message });
    }
  }
}

/**
 * Sends a message to the runtime and waits for a response.
 * Times out after `timeoutMs` milliseconds.
 *
 * @param {string} type
 * @param {unknown} payload
 * @param {string} [source]
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<unknown>} Resolves with the response payload.
 */
export function sendToRuntimeWithResponse(type, payload, source = ComponentId.POPUP, timeoutMs = 5_000) {
  const requestId = generateRequestId();
  const message   = buildMessage(type, payload, source, requestId);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`MessageBus timeout: no response for ${type} (${requestId})`));
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Sends a message to a specific tab's content script.
 *
 * @param {number} tabId
 * @param {string} type
 * @param {unknown} payload
 * @param {string} [source]
 * @returns {Promise<void>}
 */
export async function sendToTab(tabId, type, payload, source = ComponentId.SERVICE_WORKER) {
  const message = buildMessage(type, payload, source);
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    // Content script may not be injected yet on restricted pages.
    log.warn(`sendToTab(${tabId}) failed`, { type, error: err.message });
  }
}

/**
 * Sends a message to all connected tabs with the content script.
 *
 * @param {string} type
 * @param {unknown} payload
 * @param {string} [source]
 * @returns {Promise<void>}
 */
export async function broadcastToAllTabs(type, payload, source = ComponentId.SERVICE_WORKER) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.map((tab) => sendToTab(tab.id, type, payload, source))
  );
}

/**
 * Registers a message listener. Handles both fire-and-forget and
 * request-response (when `sendResponse` is required).
 *
 * @param {function(Message, chrome.runtime.MessageSender, function): boolean|void} handler
 * @returns {function} Cleanup function to remove the listener.
 */
export function onMessage(handler) {
  /**
   * Chrome runtime listener wrapper.
   * @param {Message} message
   * @param {chrome.runtime.MessageSender} sender
   * @param {function} sendResponse
   * @returns {boolean}
   */
  function listener(message, sender, sendResponse) {
    // Validate envelope — reject malformed messages.
    if (!message?.type || !Object.values(MessageType).includes(message.type)) {
      log.warn('Received malformed message — missing or unknown type', message);
      return false;
    }

    const result = handler(message, sender, sendResponse);

    // Return true to keep the response channel open for async handlers.
    return result === true;
  }

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
