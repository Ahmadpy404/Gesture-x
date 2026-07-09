/**
 * @fileoverview Global error boundary for Gesture X.
 * Catches uncaught errors and unhandled promise rejections across all
 * extension contexts, logs them with full context, and attempts recovery.
 */

import { createLogger } from './Logger.js';
import { ComponentId } from './constants.js';

const log = createLogger('ErrorHandler');

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** @enum {string} Categorizes errors for reporting and recovery. */
export const ErrorType = Object.freeze({
  CAMERA_ACCESS:      'CAMERA_ACCESS',
  MIC_ACCESS:         'MIC_ACCESS',
  MEDIAPIPE:          'MEDIAPIPE',
  SPEECH_API:         'SPEECH_API',
  CHROME_API:         'CHROME_API',
  STORAGE:            'STORAGE',
  MESSAGE_BUS:        'MESSAGE_BUS',
  OFFSCREEN:          'OFFSCREEN',
  UNKNOWN:            'UNKNOWN',
});

// ---------------------------------------------------------------------------
// GestureXError — structured error class
// ---------------------------------------------------------------------------

/**
 * Structured error class for Gesture X.
 * Includes component context, error type, and optional recovery hint.
 */
export class GestureXError extends Error {
  /**
   * @param {string} message
   * @param {string} type - ErrorType constant.
   * @param {string} component - ComponentId constant.
   * @param {unknown} [cause] - Original error.
   * @param {string} [recoveryHint] - Human-readable recovery suggestion.
   */
  constructor(message, type, component, cause, recoveryHint) {
    super(message);
    this.name        = 'GestureXError';
    this.type        = type ?? ErrorType.UNKNOWN;
    this.component   = component ?? ComponentId.SERVICE_WORKER;
    this.cause       = cause;
    this.recoveryHint = recoveryHint ?? null;
    this.timestamp   = Date.now();
  }
}

// ---------------------------------------------------------------------------
// Global error boundary installation
// ---------------------------------------------------------------------------

/**
 * Installs global uncaught error and unhandled rejection handlers.
 * Should be called once at the entry point of each extension context
 * (service worker, offscreen, content, popup).
 *
 * @param {string} component - ComponentId of the calling context.
 */
export function installGlobalErrorHandlers(component) {
  // Uncaught synchronous errors
  globalThis.addEventListener?.('error', (event) => {
    log.error(`[${component}] Uncaught error:`, {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      col: event.colno,
      error: event.error,
    });
    // Don't re-throw — allow extension to keep running.
    event.preventDefault();
  });

  // Unhandled promise rejections
  globalThis.addEventListener?.('unhandledrejection', (event) => {
    log.error(`[${component}] Unhandled promise rejection:`, {
      reason: event.reason,
    });
    event.preventDefault();
  });

  log.debug(`Global error handlers installed for ${component}`);
}

// ---------------------------------------------------------------------------
// Structured error reporter
// ---------------------------------------------------------------------------

/**
 * Reports a structured error with full context. Use this instead of
 * raw try/catch re-throws when you want consistent error tracking.
 *
 * @param {GestureXError | Error} error
 * @param {string} [context] - Additional context string.
 */
export function reportError(error, context) {
  if (error instanceof GestureXError) {
    log.error(
      `[${error.component}] ${error.type}: ${error.message}`,
      {
        cause:        error.cause,
        recoveryHint: error.recoveryHint,
        context,
        timestamp:    error.timestamp,
      }
    );
  } else {
    log.error(`Error: ${error.message}`, { context, stack: error.stack });
  }
}

// ---------------------------------------------------------------------------
// Safe async wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps an async function so errors are reported without crashing the caller.
 * Returns `null` on failure.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} [context]
 * @returns {Promise<T | null>}
 */
export async function safeAsync(fn, context) {
  try {
    return await fn();
  } catch (err) {
    reportError(err, context);
    return null;
  }
}
