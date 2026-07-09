/**
 * @fileoverview Typed chrome.storage wrappers for Gesture X.
 * Provides schema-validated read/write access to both local (persistent)
 * and session (ephemeral) storage with migration support.
 */

import { StorageKey, DEFAULT_SETTINGS, DEFAULT_SESSION } from './constants.js';
import { createLogger } from './Logger.js';

const log = createLogger('StorageManager');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-merges `defaults` with `stored`, giving stored values priority.
 * Adds any new keys from defaults that are missing in stored (forward migration).
 *
 * @template T
 * @param {T} defaults
 * @param {Partial<T>} stored
 * @returns {T}
 */
function mergeWithDefaults(defaults, stored) {
  const result = { ...defaults };
  for (const key of Object.keys(stored)) {
    if (key in result && typeof stored[key] === 'object' && stored[key] !== null && !Array.isArray(stored[key])) {
      result[key] = mergeWithDefaults(result[key], stored[key]);
    } else {
      result[key] = stored[key];
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Settings (chrome.storage.local — persistent)
// ---------------------------------------------------------------------------

/**
 * Reads the full settings object from chrome.storage.local.
 * Merges with defaults to handle forward migrations (new keys added in updates).
 *
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  try {
    const result = await chrome.storage.local.get(StorageKey.SETTINGS);
    const stored = result[StorageKey.SETTINGS];

    if (!stored) {
      log.info('No stored settings found — using defaults');
      return { ...DEFAULT_SETTINGS };
    }

    return mergeWithDefaults(DEFAULT_SETTINGS, stored);
  } catch (err) {
    log.error('Failed to read settings', err);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Writes the full settings object to chrome.storage.local.
 *
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ [StorageKey.SETTINGS]: settings });
    log.debug('Settings saved');
  } catch (err) {
    log.error('Failed to save settings', err);
    throw err;
  }
}

/**
 * Updates a single setting key without overwriting the rest.
 *
 * @template K
 * @param {K} key - Key of DEFAULT_SETTINGS.
 * @param {typeof DEFAULT_SETTINGS[K]} value
 * @returns {Promise<void>}
 */
export async function updateSetting(key, value) {
  const current = await getSettings();
  if (!(key in current)) {
    throw new Error(`StorageManager: Unknown settings key "${key}"`);
  }
  current[key] = value;
  await saveSettings(current);
}

/**
 * Resets all settings to factory defaults.
 *
 * @returns {Promise<void>}
 */
export async function resetSettings() {
  await saveSettings({ ...DEFAULT_SETTINGS });
  log.info('Settings reset to defaults');
}

// ---------------------------------------------------------------------------
// Session state (chrome.storage.session — ephemeral)
// ---------------------------------------------------------------------------

/**
 * Reads the current session state.
 * Falls back to defaults if session was cleared (e.g., browser restart).
 *
 * @returns {Promise<typeof DEFAULT_SESSION>}
 */
export async function getSession() {
  try {
    const result = await chrome.storage.session.get(StorageKey.SESSION);
    const stored = result[StorageKey.SESSION];
    if (!stored) return { ...DEFAULT_SESSION };
    return mergeWithDefaults(DEFAULT_SESSION, stored);
  } catch (err) {
    log.error('Failed to read session', err);
    return { ...DEFAULT_SESSION };
  }
}

/**
 * Writes the full session state.
 *
 * @param {typeof DEFAULT_SESSION} session
 * @returns {Promise<void>}
 */
export async function saveSession(session) {
  try {
    await chrome.storage.session.set({ [StorageKey.SESSION]: session });
  } catch (err) {
    log.error('Failed to save session', err);
    throw err;
  }
}

/**
 * Updates a single session key without overwriting the rest.
 *
 * @template K
 * @param {K} key - Key of DEFAULT_SESSION.
 * @param {typeof DEFAULT_SESSION[K]} value
 * @returns {Promise<void>}
 */
export async function updateSession(key, value) {
  const current = await getSession();
  if (!(key in current)) {
    throw new Error(`StorageManager: Unknown session key "${key}"`);
  }
  current[key] = value;
  await saveSession(current);
}

/**
 * Clears the session state (called on extension disable or browser close).
 *
 * @returns {Promise<void>}
 */
export async function clearSession() {
  try {
    await chrome.storage.session.remove(StorageKey.SESSION);
    log.info('Session cleared');
  } catch (err) {
    log.error('Failed to clear session', err);
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initializes storage on first install.
 * Called from the service worker's `chrome.runtime.onInstalled` handler.
 *
 * @returns {Promise<void>}
 */
export async function initializeStorage() {
  const result = await chrome.storage.local.get(StorageKey.SETTINGS);
  if (!result[StorageKey.SETTINGS]) {
    await saveSettings({ ...DEFAULT_SETTINGS });
    log.info('Initialized default settings on first install');
  } else {
    // Run forward migration: merge stored with latest defaults.
    const migrated = mergeWithDefaults(DEFAULT_SETTINGS, result[StorageKey.SETTINGS]);
    await saveSettings(migrated);
    log.info('Settings migrated to latest schema version');
  }
  await saveSession({ ...DEFAULT_SESSION });
}
