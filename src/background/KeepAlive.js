/**
 * @fileoverview Service Worker keepalive for Gesture X.
 * MV3 Service Workers are ephemeral and will terminate after ~30s of inactivity.
 * This module uses chrome.alarms to periodically wake the SW and update the
 * heartbeat timestamp in session storage.
 */

import { Timing, StorageKey } from '../shared/constants.js';
import { createLogger } from '../shared/Logger.js';

const log = createLogger('KeepAlive');

const ALARM_NAME = 'gesture_x_keepalive';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Starts the keepalive alarm. Safe to call multiple times — deduplicates.
 * Should be called from `chrome.runtime.onInstalled` and `chrome.runtime.onStartup`.
 *
 * @returns {Promise<void>}
 */
export async function startKeepAlive() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing) {
    log.debug('KeepAlive alarm already running');
    return;
  }

  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes:  0.1,                                                // Fire in ~6s
    periodInMinutes: Timing.SW_HEARTBEAT_INTERVAL_MS / 60_000,          // 25s
  });

  log.info('KeepAlive alarm started');
}

/**
 * Stops the keepalive alarm.
 * Called when the extension is disabled or during cleanup.
 *
 * @returns {Promise<void>}
 */
export async function stopKeepAlive() {
  await chrome.alarms.clear(ALARM_NAME);
  log.info('KeepAlive alarm stopped');
}

/**
 * Handles a keepalive alarm tick.
 * Updates the heartbeat timestamp in session storage and logs SW health.
 *
 * @param {chrome.alarms.Alarm} alarm
 * @returns {Promise<void>}
 */
export async function handleKeepAliveAlarm(alarm) {
  if (alarm.name !== ALARM_NAME) return;

  const heartbeat = Date.now();

  try {
    const result  = await chrome.storage.session.get(StorageKey.SESSION);
    const session = result[StorageKey.SESSION] ?? {};
    session.swHeartbeat = heartbeat;
    await chrome.storage.session.set({ [StorageKey.SESSION]: session });
    log.debug(`Heartbeat: ${new Date(heartbeat).toISOString()}`);
  } catch (err) {
    log.warn('Failed to write heartbeat', err);
  }
}
