/**
 * @fileoverview Gesture X — HUDManager
 *
 * Singleton that owns the Shadow DOM overlay injected into every page.
 * Manages the full lifecycle of the HUD host element and all toast notifications.
 *
 * Architecture:
 *   document.documentElement
 *     └── <div id="gesture-x-hud"> (host element — injected once)
 *           └── ShadowRoot (mode: 'closed')
 *                 ├── <style> HUD_CSS
 *                 └── <div id="toast-container">
 *                       ├── GestureToast  ← newest at top (column-reverse)
 *                       └── GestureToast
 *
 * Key properties:
 *  - Shadow DOM (closed) — fully isolated from page styles and JS
 *  - pointer-events: none on :host — HUD never blocks page interactions
 *  - Max MAX_TOASTS visible simultaneously — oldest dismissed if queue is full
 *  - Survives document mutations via MutationObserver re-attachment
 *  - Respects `feedbackHUD` user setting — no-ops if disabled
 */

import { HUD_CSS }      from './HUDStyles.js';
import { GestureToast } from './GestureToast.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOST_ID    = 'gesture-x-hud';
const MAX_TOASTS = 3;

// ---------------------------------------------------------------------------
// HUDManager
// ---------------------------------------------------------------------------

class HUDManagerClass {
  /** @type {ShadowRoot | null} */
  #shadow = null;

  /** @type {HTMLElement | null} */
  #container = null;

  /** @type {GestureToast[]} */
  #toasts = [];

  /** @type {boolean} Whether the HUD is enabled. Updated by show(). */
  #enabled = true;

  /** @type {MutationObserver | null} */
  #observer = null;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Shows a toast notification in the HUD.
   * Safe to call before the DOM is ready — will initialize lazily.
   *
   * @param {object} payload
   * @param {string} payload.label      - Gesture label or voice transcript.
   * @param {string} payload.commandId  - CommandId string.
   * @param {string} [payload.hand]     - 'Left' | 'Right' | 'voice'.
   * @param {number} [payload.confidence] - 0–1.
   * @param {string} payload.source     - 'gesture' | 'voice'.
   * @param {boolean} [payload.hudEnabled] - If explicitly false, skip showing.
   */
  show(payload) {
    if (payload?.hudEnabled === false) return;

    this.#ensureInitialized();
    if (!this.#container) return;

    // Trim queue if at capacity
    while (this.#toasts.length >= MAX_TOASTS) {
      this.#toasts.shift()?.dismiss();
    }

    // Remove already-dismissed toasts from tracking array
    this.#toasts = this.#toasts.filter((t) => !t.isDismissed);

    const toast = new GestureToast(this.#container, payload);
    this.#toasts.push(toast);
  }

  /**
   * Immediately dismisses all visible toasts.
   */
  hide() {
    for (const toast of this.#toasts) {
      toast.dismiss();
    }
    this.#toasts = [];
  }

  /**
   * Fully destroys the HUD host element and disconnects the observer.
   * Call when Gesture X is deactivated.
   */
  destroy() {
    this.hide();
    this.#observer?.disconnect();
    this.#observer   = null;
    this.#shadow     = null;
    this.#container  = null;

    const host = document.getElementById(HOST_ID);
    host?.remove();
  }

  // -------------------------------------------------------------------------
  // Private — initialization
  // -------------------------------------------------------------------------

  /**
   * Creates the Shadow DOM host if it doesn't already exist.
   * Idempotent — safe to call multiple times.
   */
  #ensureInitialized() {
    // Already initialized
    if (this.#shadow && document.getElementById(HOST_ID)) return;

    // Host might have been removed by page DOM mutations (rare but possible)
    const existingHost = document.getElementById(HOST_ID);
    if (existingHost) {
      existingHost.remove();
    }

    // Create host element
    const host = document.createElement('div');
    host.id = HOST_ID;

    // Append to <html> (not <body>) so it survives SPA route changes that swap <body> children
    document.documentElement.appendChild(host);

    // Attach a closed Shadow Root — page JS cannot access it
    this.#shadow = host.attachShadow({ mode: 'closed' });

    // Inject styles
    const styleEl = document.createElement('style');
    styleEl.textContent = HUD_CSS;
    this.#shadow.appendChild(styleEl);

    // Create toast container
    this.#container = document.createElement('div');
    this.#container.id = 'toast-container';
    this.#container.setAttribute('aria-live', 'polite');
    this.#container.setAttribute('aria-atomic', 'false');
    this.#shadow.appendChild(this.#container);

    // Watch for the host being removed from the DOM by aggressive page scripts
    this.#watchHostSurvival(host);
  }

  /**
   * Monitors the host element for removal and re-attaches if needed.
   * Handles aggressive SPAs that call `document.body.innerHTML = ''`.
   *
   * @param {HTMLElement} host
   */
  #watchHostSurvival(host) {
    this.#observer?.disconnect();

    this.#observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const removed of mutation.removedNodes) {
          if (removed === host || removed.contains?.(host)) {
            // Host was removed — re-initialize on next show()
            this.#shadow    = null;
            this.#container = null;
            this.#toasts    = [];
            this.#observer?.disconnect();
            this.#observer = null;
            return;
          }
        }
      }
    });

    this.#observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
}

// Export as a singleton — one HUD per content-script instance
export const HUDManager = new HUDManagerClass();
