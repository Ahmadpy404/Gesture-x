/**
 * @fileoverview Gesture X — GestureToast
 *
 * A single animated toast notification rendered inside the HUD Shadow DOM.
 * Each toast is self-managing: it creates its own DOM, schedules its own
 * auto-dismiss, and cleans up after itself.
 *
 * Lifecycle:
 *   new GestureToast(container, payload, options)
 *     → creates DOM, appends to container, starts progress countdown
 *     → after AUTO_DISMISS_MS: triggers exit animation, then removes from DOM
 *   dismiss() → can also be called externally for immediate hide
 */

// ---------------------------------------------------------------------------
// Display maps
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} Emoji icon for each gesture label. */
const GESTURE_ICONS = {
  SWIPE_LEFT:  '←',
  SWIPE_RIGHT: '→',
  SWIPE_UP:    '↑',
  SWIPE_DOWN:  '↓',
  PINCH:       '🤌',
  PEACE:       '✌️',
  FIST:        '✊',
  OPEN_PALM:   '🖐',
  THUMBS_UP:   '👍',
  THUMBS_DOWN: '👎',
};

/** @type {Record<string, string>} Human-readable command names. */
const COMMAND_NAMES = {
  NAV_BACK:          'Back',
  NAV_FORWARD:       'Forward',
  NAV_RELOAD:        'Reload',
  NAV_HOME:          'Home',
  TAB_NEW:           'New Tab',
  TAB_CLOSE:         'Close Tab',
  TAB_NEXT:          'Next Tab',
  TAB_PREV:          'Previous Tab',
  TAB_REOPEN:        'Reopen Tab',
  SCROLL_UP:         'Scroll Up',
  SCROLL_DOWN:       'Scroll Down',
  SCROLL_TOP:        'Scroll to Top',
  SCROLL_BOTTOM:     'Scroll to Bottom',
  ZOOM_IN:           'Zoom In',
  ZOOM_OUT:          'Zoom Out',
  ZOOM_RESET:        'Reset Zoom',
  WINDOW_FULLSCREEN: 'Fullscreen',
  WINDOW_MINIMIZE:   'Minimize',
  BOOKMARK_ADD:      'Bookmarked!',
  NONE:              'No Action',
};

/** @type {Record<string, string>} Gesture label → human name. */
const GESTURE_NAMES = {
  SWIPE_LEFT:  'Swipe Left',
  SWIPE_RIGHT: 'Swipe Right',
  SWIPE_UP:    'Swipe Up',
  SWIPE_DOWN:  'Swipe Down',
  PINCH:       'Pinch',
  PEACE:       'Peace',
  FIST:        'Fist',
  OPEN_PALM:   'Open Palm',
  THUMBS_UP:   'Thumbs Up',
  THUMBS_DOWN: 'Thumbs Down',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_DISMISS_MS  = 2_500;
const EXIT_ANIM_MS     = 250;

// ---------------------------------------------------------------------------
// GestureToast
// ---------------------------------------------------------------------------

export class GestureToast {
  /** @type {HTMLElement} */
  #el;

  /** @type {number | null} */
  #dismissTimer = null;

  /** @type {boolean} */
  #dismissed = false;

  /**
   * @param {HTMLElement} container - Shadow DOM container to append to.
   * @param {object} payload
   * @param {string} payload.label      - Gesture label (e.g. 'SWIPE_LEFT') or voice transcript.
   * @param {string} payload.commandId  - CommandId string.
   * @param {string} [payload.hand]     - 'Left' | 'Right' | 'voice'.
   * @param {number} [payload.confidence] - 0–1.
   * @param {string} payload.source     - 'gesture' | 'voice'.
   * @param {number} [dismissMs]        - Override auto-dismiss duration in ms.
   */
  constructor(container, payload, dismissMs = AUTO_DISMISS_MS) {
    this.#el = this.#build(payload, dismissMs);
    container.appendChild(this.#el);

    // Schedule auto-dismiss
    this.#dismissTimer = setTimeout(() => this.dismiss(), dismissMs);
  }

  // -------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------

  /** Triggers the exit animation and removes the toast from the DOM. */
  dismiss() {
    if (this.#dismissed) return;
    this.#dismissed = true;

    if (this.#dismissTimer !== null) {
      clearTimeout(this.#dismissTimer);
      this.#dismissTimer = null;
    }

    this.#el.classList.add('dismissing');

    // Remove from DOM after exit animation completes
    setTimeout(() => {
      this.#el.remove();
    }, EXIT_ANIM_MS + 20);
  }

  /** @returns {boolean} True if this toast has been dismissed. */
  get isDismissed() { return this.#dismissed; }

  // -------------------------------------------------------------------------
  // Private — DOM construction
  // -------------------------------------------------------------------------

  /**
   * Builds the toast DOM element.
   * @param {object} payload
   * @param {number} dismissMs
   * @returns {HTMLElement}
   */
  #build(payload, dismissMs) {
    const { label, commandId, hand, confidence, source } = payload;
    const isVoice   = source === 'voice';
    const icon      = isVoice ? '🎤' : (GESTURE_ICONS[label]  ?? '✋');
    const topLabel  = isVoice
      ? `Voice: "${label}"`
      : (GESTURE_NAMES[label] ?? label);
    const cmdName   = COMMAND_NAMES[commandId] ?? commandId ?? '';
    const pct       = confidence ? `${Math.round(confidence * 100)}%` : '';
    const handLabel = hand && hand !== 'voice' ? hand : '';

    const el = document.createElement('div');
    el.className = `toast${isVoice ? ' voice' : ''}`;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', `Gesture X: ${topLabel} — ${cmdName}`);

    // Set CSS variable for the progress bar duration
    el.style.setProperty('--duration', `${dismissMs}ms`);

    el.innerHTML = `
      <div class="toast-watermark">GESTURE X</div>
      <div class="toast-body">
        <div class="toast-icon" aria-hidden="true">${icon}</div>
        <div class="toast-label">${this.#escape(topLabel)}</div>
        <div class="toast-badge">
          ${pct ? `<span>${pct}</span>` : ''}
          ${handLabel ? `<span class="hand">${this.#escape(handLabel)}</span>` : ''}
        </div>
        <div class="toast-command">${this.#escape(cmdName)}</div>
      </div>
      <div class="toast-progress" aria-hidden="true"></div>
    `;

    return el;
  }

  /**
   * Escapes HTML to prevent XSS from transcript content.
   * Voice transcripts come from SpeechRecognition and should never contain
   * executable content, but we escape defensively.
   *
   * @param {string} str
   * @returns {string}
   */
  #escape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
