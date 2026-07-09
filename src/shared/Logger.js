/**
 * @fileoverview Structured logger for Gesture X.
 * In development: colorized console output with component tagging.
 * In production: only warnings and errors are emitted.
 * Never use console.log directly — always use this module.
 */

/** @enum {number} Log severity levels. */
const Level = Object.freeze({ DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 });

/** Minimum level to emit in production builds. */
const PROD_MIN_LEVEL = Level.WARN;

/** Whether we are in a development context. */
const IS_DEV = typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function'
  ? !('update_url' in chrome.runtime.getManifest())
  : true;

/** ANSI-style console colors (works in Chrome DevTools). */
const COLOR = Object.freeze({
  DEBUG: 'color:#64748b;font-weight:bold',
  INFO:  'color:#38bdf8;font-weight:bold',
  WARN:  'color:#fbbf24;font-weight:bold',
  ERROR: 'color:#f87171;font-weight:bold',
  RESET: 'color:inherit;font-weight:normal',
});

/**
 * Creates a namespaced logger instance for a specific component.
 *
 * @param {string} component - The component name (e.g., 'ServiceWorker', 'GestureEngine').
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(component) {
  const minLevel = IS_DEV ? Level.DEBUG : PROD_MIN_LEVEL;
  const prefix   = `[GestureX:${component}]`;

  /**
   * Internal emit function.
   * @param {number} level
   * @param {string} levelName
   * @param {string} message
   * @param {...unknown} args
   */
  function emit(level, levelName, message, ...args) {
    if (level < minLevel) return;

    const colorStyle = COLOR[levelName];
    const timestamp  = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

    switch (level) {
      case Level.ERROR:
        console.error(`%c${prefix}%c [${timestamp}] ${message}`, colorStyle, COLOR.RESET, ...args);
        break;
      case Level.WARN:
        console.warn(`%c${prefix}%c [${timestamp}] ${message}`, colorStyle, COLOR.RESET, ...args);
        break;
      default:
        console.log(`%c${prefix}%c [${timestamp}] ${message}`, colorStyle, COLOR.RESET, ...args);
    }
  }

  return Object.freeze({
    /** @param {string} message @param {...unknown} args */
    debug: (message, ...args) => emit(Level.DEBUG, 'DEBUG', message, ...args),
    /** @param {string} message @param {...unknown} args */
    info:  (message, ...args) => emit(Level.INFO,  'INFO',  message, ...args),
    /** @param {string} message @param {...unknown} args */
    warn:  (message, ...args) => emit(Level.WARN,  'WARN',  message, ...args),
    /** @param {string} message @param {...unknown} args */
    error: (message, ...args) => emit(Level.ERROR, 'ERROR', message, ...args),
  });
}

/** Convenience singleton for modules that don't need a named component. */
export const logger = createLogger('GestureX');
