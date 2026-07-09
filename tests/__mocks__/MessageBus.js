/** @fileoverview MessageBus stub for Jest — captures sent messages for assertion. */

/** All messages sent during the test run, in order. */
export const sentMessages = [];

export function sendToRuntime(type, payload, source) {
  sentMessages.push({ type, payload, source });
  return Promise.resolve({ ok: true });
}

export function sendToRuntimeWithResponse(type, payload, source) {
  sentMessages.push({ type, payload, source });
  return Promise.resolve(null);
}

export function onMessage(handler) {
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

export function clearSentMessages() { sentMessages.length = 0; }

export function sendToTab(tabId, type, payload, source) {
  sentMessages.push({ type, payload, source, tabId });
  return Promise.resolve({ ok: true });
}

export function broadcastToAllTabs(type, payload, source) {
  sentMessages.push({ type, payload, source, broadcast: true });
  return Promise.resolve({ ok: true });
}
