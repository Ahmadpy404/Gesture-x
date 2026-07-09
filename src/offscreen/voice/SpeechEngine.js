/**
 * @fileoverview Gesture X — SpeechEngine
 *
 * Always-on voice recognition pipeline using the Web Speech API.
 * Designed for use inside an MV3 offscreen document.
 *
 * Design goals (V1):
 *  - Always-on: recognition restarts automatically after every utterance
 *    or browser-initiated stop (no wake-word required).
 *  - Resilient: exponential back-off on repeated failures, stops at max retries.
 *  - Lean: zero dependencies outside Web Speech API + VoiceCommandMatcher.
 *  - Pluggable: implements the speechEnginePlugin interface { start, stop }.
 *
 * State machine:
 *
 *   IDLE ──start()──→ STARTING ──onstart──→ ACTIVE ──silence──→ RESTARTING
 *     ↑                                        │                     │
 *     └──────────────stop()───────────────────←┘                     │
 *                                                                     │
 *   ERROR ←── max retries or not-allowed ───── RESTARTING ←──────────┘
 *
 * Auto-restart:
 *  - Web Speech API fires 'end' after silence even with `continuous: true`.
 *  - On 'end': if shouldBeActive, schedule restart after restartDelay.
 *  - restartDelay doubles on each restart (100ms → 200 → 400 → … → 5000ms).
 *  - Resets to 100ms on a successful final result (user spoke, system recovered).
 *  - After MAX_RESTART_ATTEMPTS consecutive restarts without a result → ERROR.
 *
 * Microphone permission:
 *  - SpeechRecognition uses its own mic permission (separate from getUserMedia).
 *  - 'not-allowed' error means permission is denied → sent to SW as OFFSCREEN_ERROR
 *    with context: 'speech' so only the mic indicator resets, not the camera.
 */

import { VoiceCommandMatcher }        from './VoiceCommandMatcher.js';
import { sendToRuntime }              from '../../shared/MessageBus.js';
import { createLogger }               from '../../shared/Logger.js';
import { MessageType, ComponentId }   from '../../shared/constants.js';

const log = createLogger('SpeechEngine');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_RESTART_DELAY_MS = 100;
const MAX_RESTART_DELAY_MS     = 5_000;
const MAX_RESTART_ATTEMPTS     = 15;
const RECOGNITION_LANG         = 'en-US';
const MAX_ALTERNATIVES         = 5;   // try up to 5 transcripts per result

// ---------------------------------------------------------------------------
// SpeechState enum
// ---------------------------------------------------------------------------

/** @enum {string} */
export const SpeechState = Object.freeze({
  IDLE:       'IDLE',
  STARTING:   'STARTING',
  ACTIVE:     'ACTIVE',
  RESTARTING: 'RESTARTING',
  STOPPING:   'STOPPING',
  ERROR:      'ERROR',
});

// ---------------------------------------------------------------------------
// SpeechEngine
// ---------------------------------------------------------------------------

export class SpeechEngine {
  /** @type {SpeechRecognition | null} */
  #recognition = null;

  /** @type {SpeechState} */
  #state = SpeechState.IDLE;

  /** @type {VoiceCommandMatcher} */
  #matcher = new VoiceCommandMatcher();

  /** Whether the engine is supposed to be active (intent flag). */
  #shouldBeActive = false;

  /** Delay (ms) before the next restart attempt. */
  #restartDelay = INITIAL_RESTART_DELAY_MS;

  /** Consecutive restarts without a successful result. */
  #restartAttempts = 0;

  /** @type {number | null} setTimeout handle for pending restart. */
  #restartTimer = null;

  // Metrics
  #totalResults    = 0;
  #matchedResults  = 0;

  // -------------------------------------------------------------------------
  // Public API (implements speechEnginePlugin interface)
  // -------------------------------------------------------------------------

  /**
   * Starts voice recognition.
   * Safe to call multiple times — idempotent if already active.
   */
  async start() {
    if (this.#shouldBeActive) {
      log.debug('SpeechEngine already active');
      return;
    }

    if (!this.#isSpeechRecognitionAvailable()) {
      this.#handleFatalError('Web Speech API (SpeechRecognition) is not available in this context.');
      return;
    }

    log.info('SpeechEngine starting...');
    this.#shouldBeActive = true;
    this.#restartDelay   = INITIAL_RESTART_DELAY_MS;
    this.#restartAttempts = 0;

    this.#createAndStart();
  }

  /**
   * Stops voice recognition and clears all restart timers.
   * Safe to call if already stopped.
   */
  stop() {
    if (!this.#shouldBeActive) return;

    log.info(`SpeechEngine stopping — ${this.#totalResults} results, ${this.#matchedResults} matched`);
    this.#shouldBeActive = false;
    this.#setState(SpeechState.STOPPING);

    // Cancel pending restart
    if (this.#restartTimer !== null) {
      clearTimeout(this.#restartTimer);
      this.#restartTimer = null;
    }

    // Stop recognition (triggers 'end' event — handled safely)
    try {
      this.#recognition?.abort();
    } catch {
      // Already stopped — safe to ignore
    }

    this.#recognition = null;
    this.#setState(SpeechState.IDLE);
  }

  /** @returns {boolean} True if recognition is currently running. */
  get isActive() {
    return this.#state === SpeechState.ACTIVE || this.#state === SpeechState.STARTING;
  }

  /** @returns {SpeechState} Current engine state. */
  get state() { return this.#state; }

  // -------------------------------------------------------------------------
  // Private — recognition lifecycle
  // -------------------------------------------------------------------------

  /**
   * Creates a fresh SpeechRecognition instance and starts it.
   * A new instance is created each time because the Web Speech API
   * does not support restarting the same instance in all browsers.
   */
  #createAndStart() {
    // Clean up any previous instance
    if (this.#recognition) {
      this.#recognition.onstart  = null;
      this.#recognition.onresult = null;
      this.#recognition.onerror  = null;
      this.#recognition.onend    = null;
      try { this.#recognition.abort(); } catch { /* ignore */ }
      this.#recognition = null;
    }

    const SR = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition;
    this.#recognition = new SR();

    // Configuration
    this.#recognition.continuous       = true;
    this.#recognition.interimResults   = false;  // Only process final results
    this.#recognition.lang             = RECOGNITION_LANG;
    this.#recognition.maxAlternatives  = MAX_ALTERNATIVES;

    // Bind event handlers
    this.#recognition.onstart  = this.#onStart.bind(this);
    this.#recognition.onresult = this.#onResult.bind(this);
    this.#recognition.onerror  = this.#onError.bind(this);
    this.#recognition.onend    = this.#onEnd.bind(this);

    this.#setState(SpeechState.STARTING);

    try {
      this.#recognition.start();
    } catch (err) {
      // InvalidStateError — already started (race condition)
      log.warn('recognition.start() threw:', err.message);
      this.#scheduleRestart();
    }
  }

  // -------------------------------------------------------------------------
  // Private — SpeechRecognition event handlers
  // -------------------------------------------------------------------------

  #onStart() {
    this.#setState(SpeechState.ACTIVE);
    this.#restartAttempts = 0; // Reset on successful start
    log.debug('Recognition active — listening...');
  }

  /**
   * @param {SpeechRecognitionEvent} event
   */
  #onResult(event) {
    // Reset backoff: user successfully spoke
    this.#restartDelay    = INITIAL_RESTART_DELAY_MS;
    this.#restartAttempts = 0;

    // Process all new final results
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result.isFinal) continue;

      this.#totalResults++;

      // Try each alternative transcript (best → worst confidence)
      const alternatives = Array.from({ length: result.length }, (_, k) => result[k]);
      let   matched      = false;

      for (const alternative of alternatives) {
        const transcript = alternative.transcript?.trim();
        if (!transcript) continue;

        log.debug(`Transcript: "${transcript}" (speech confidence: ${alternative.confidence?.toFixed(2)})`);

        const match = this.#matcher.match(transcript);
        if (match) {
          this.#matchedResults++;
          matched = true;

          // Combine speech API confidence with matcher confidence
          const combinedConfidence = Math.min(
            1,
            (alternative.confidence ?? 0.8) * 0.4 + match.confidence * 0.6
          );

          this.#dispatchVoiceCommand({
            commandId:  match.commandId,
            transcript: match.transcript,
            phrase:     match.phrase,
            matchType:  match.matchType,
            confidence: combinedConfidence,
            text:       match.text,
          });
          break; // Use the first matching alternative
        }
      }

      if (!matched) {
        log.debug(`No command matched for result #${this.#totalResults}`);
      }
    }
  }

  /**
   * @param {SpeechRecognitionErrorEvent} event
   */
  #onError(event) {
    const { error, message } = event;
    log.warn(`Recognition error: ${error}${message ? ` — ${message}` : ''}`);

    switch (error) {
      case 'not-allowed':
      case 'service-not-allowed':
        // Permission denied — unrecoverable without user action
        this.#handleFatalError(
          'Microphone access denied. Open Chrome settings to allow microphone for this extension.'
        );
        break;

      case 'no-speech':
        // Normal — user didn't speak. 'end' will fire and trigger restart.
        break;

      case 'audio-capture':
        // No microphone device found
        this.#handleFatalError('No microphone device found.');
        break;

      case 'network':
        // Speech API requires network for server-side recognition in some locales.
        // Schedule restart — may recover when network returns.
        log.warn('Network error in speech recognition — will retry');
        break;

      case 'aborted':
        // Deliberate abort (from stop()) — ignore
        break;

      default:
        log.warn(`Unhandled speech error: ${error}`);
        break;
    }
  }

  /**
   * Called when recognition stops for any reason.
   * Schedules a restart if the engine should still be active.
   */
  #onEnd() {
    log.debug(`Recognition ended (shouldBeActive: ${this.#shouldBeActive})`);

    if (!this.#shouldBeActive) {
      this.#setState(SpeechState.IDLE);
      return;
    }

    // Auto-restart
    this.#setState(SpeechState.RESTARTING);
    this.#scheduleRestart();
  }

  // -------------------------------------------------------------------------
  // Private — restart logic
  // -------------------------------------------------------------------------

  /**
   * Schedules a restart with the current backoff delay, then doubles it.
   */
  #scheduleRestart() {
    if (!this.#shouldBeActive) return;

    this.#restartAttempts++;

    if (this.#restartAttempts > MAX_RESTART_ATTEMPTS) {
      this.#handleFatalError(
        `Speech recognition failed after ${MAX_RESTART_ATTEMPTS} consecutive restart attempts.`
      );
      return;
    }

    const delay = this.#restartDelay;
    this.#restartDelay = Math.min(this.#restartDelay * 2, MAX_RESTART_DELAY_MS);

    log.debug(`Scheduling restart #${this.#restartAttempts} in ${delay}ms`);

    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null;
      if (this.#shouldBeActive) {
        this.#createAndStart();
      }
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Private — error reporting
  // -------------------------------------------------------------------------

  /**
   * Handles a fatal, unrecoverable error.
   * Stops the engine and notifies the service worker.
   * Uses context: 'speech' so the SW only resets the mic indicator,
   * NOT the camera pipeline.
   *
   * @param {string} errorMessage
   */
  #handleFatalError(errorMessage) {
    log.error('Fatal SpeechEngine error:', errorMessage);
    this.#shouldBeActive = false;
    this.#setState(SpeechState.ERROR);

    sendToRuntime(
      MessageType.OFFSCREEN_ERROR,
      { error: errorMessage, context: 'speech' },
      ComponentId.OFFSCREEN
    ).catch((err) => {
      log.warn('Failed to send OFFSCREEN_ERROR:', err.message);
    });
  }

  /**
   * Dispatches a matched voice command to the service worker.
   * @param {{ commandId: string, transcript: string, phrase: string, matchType: string, confidence: number }} cmd
   */
  #dispatchVoiceCommand(cmd) {
    log.info(`Voice command: "${cmd.transcript}" → ${cmd.commandId} (${(cmd.confidence * 100).toFixed(0)}%)`);

    sendToRuntime(
      MessageType.VOICE_COMMAND,
      {
        command:    cmd.commandId,
        transcript: cmd.transcript,
        phrase:     cmd.phrase,
        matchType:  cmd.matchType,
        confidence: cmd.confidence,
        text:       cmd.text,
      },
      ComponentId.OFFSCREEN
    ).catch((err) => {
      log.warn('Failed to dispatch VOICE_COMMAND:', err.message);
    });
  }

  // -------------------------------------------------------------------------
  // Private — helpers
  // -------------------------------------------------------------------------

  /**
   * Updates the internal state.
   * @param {SpeechState} newState
   */
  #setState(newState) {
    if (this.#state === newState) return;
    log.debug(`SpeechState: ${this.#state} → ${newState}`);
    this.#state = newState;
  }

  /**
   * Checks if the Web Speech API is available in this context.
   * @returns {boolean}
   */
  #isSpeechRecognitionAvailable() {
    return typeof (globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition) === 'function';
  }
}
