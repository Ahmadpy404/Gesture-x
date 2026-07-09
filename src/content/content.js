/**
 * @fileoverview Gesture X — Content Script
 *
 * Injected into every page (document_idle). Responsible for:
 *  1. Executing scroll commands from the service worker
 *  2. Rendering the HUD toast overlay (via HUDManager / Shadow DOM)
 *  3. Providing GESTURE_X_PING health-check response
 *
 * Uses raw chrome.runtime.onMessage (not the shared MessageBus ES module)
 * because content scripts with type:module still use the Chrome APIs directly.
 * The HUD modules use ES imports (supported since Chrome 92 via type:module).
 */

import { HUDManager }               from './hud/HUDManager.js';
import { installGlobalErrorHandlers } from '../shared/ErrorHandler.js';
import { ComponentId }               from '../shared/constants.js';
import { createLogger }              from '../shared/Logger.js';

const log = createLogger('Content');

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;

  switch (message.type) {
    // -----------------------------------------------------------------------
    // Scroll — executed directly in page context
    // -----------------------------------------------------------------------
    case 'EXECUTE_SCROLL':
      handleScroll(message.direction ?? message.payload?.direction);
      sendResponse({ ok: true });
      break;

    // -----------------------------------------------------------------------
    // HUD — show animated toast notification
    // -----------------------------------------------------------------------
    case 'SHOW_HUD':
      handleShowHUD(message.payload);
      sendResponse({ ok: true });
      break;

    case 'EXECUTE_DRAG':
      handleExecuteDrag(message.payload);
      sendResponse({ ok: true });
      break;

    // -----------------------------------------------------------------------
    // HUD — hide all toasts immediately
    // -----------------------------------------------------------------------
    case 'HIDE_HUD':
      HUDManager.hide();
      sendResponse({ ok: true });
      break;



    // -----------------------------------------------------------------------
    // Voice Dictation
    // -----------------------------------------------------------------------
    case 'TYPE_TEXT':
      handleTypeText(message.payload);
      sendResponse({ ok: true });
      break;

    // -----------------------------------------------------------------------
    // Health check — used by SW to verify content script is loaded
    // -----------------------------------------------------------------------
    case 'GESTURE_X_PING':
      sendResponse({ ok: true, source: 'CONTENT' });
      break;

    default:
      break;
  }

  // Return false: no async response needed after this point.
  return false;
});

// ---------------------------------------------------------------------------
// HUD handler
// ---------------------------------------------------------------------------

/**
 * Shows a gesture or voice toast in the HUD overlay.
 * @param {object} payload - See HUDManager.show() for payload shape.
 */
function handleShowHUD(payload) {
  if (!payload) return;

  try {
    HUDManager.show(payload);
  } catch (err) {
    log.warn('HUDManager.show() failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Continuous Drag Scroll implementation
// ---------------------------------------------------------------------------

let lastDragY = null;

/**
 * Handles continuous 1-to-1 sticky drag scrolling.
 * @param {{ y?: number, stop?: boolean }} payload
 */
function handleExecuteDrag(payload) {
  if (payload.stop) {
    lastDragY = null;
    return;
  }

  const { y } = payload;
  if (lastDragY === null) {
    lastDragY = y;
    return;
  }

  // Invert dy: moving hand UP (y decreases) should move content UP (scroll view DOWN)
  const dy = lastDragY - y;
  lastDragY = y;

  const target = getBestScrollTarget();
  const isRoot = target === document.documentElement || target === document.body;
  
  // y is normalized 0-1 (e.g. 0 is top of camera frame, 1 is bottom)
  // Scale the movement proportionally to the viewport size.
  const sensitivity = window.innerHeight * 2.0; 
  const scrollPx = dy * sensitivity;

  scroller.velocity = 0; // Cancel any kinetic momentum while dragging

  if (isRoot) window.scrollBy(0, scrollPx);
  else target.scrollBy(0, scrollPx);
}

// ---------------------------------------------------------------------------
// Scroll implementation
// ---------------------------------------------------------------------------

class KineticScroller {
  constructor() {
    this.velocity = 0;
    this.isAnimating = false;
    this.target = null;
    this.isRoot = false;
    this.friction = 0.92; // High friction so it glides smoothly between 200ms events
  }

  addVelocity(amount, targetElement, isRootElement) {
    this.target = targetElement;
    this.isRoot = isRootElement;
    
    // Cap maximum velocity for sanity
    const maxV = 120;
    this.velocity += amount;
    if (this.velocity > maxV) this.velocity = maxV;
    if (this.velocity < -maxV) this.velocity = -maxV;

    if (!this.isAnimating) {
      this.isAnimating = true;
      requestAnimationFrame(() => this.tick());
    }
  }

  tick() {
    if (Math.abs(this.velocity) < 0.5) {
      this.isAnimating = false;
      this.velocity = 0;
      return;
    }

    if (this.isRoot) {
      window.scrollBy(0, this.velocity);
    } else {
      this.target.scrollBy(0, this.velocity);
    }

    this.velocity *= this.friction;
    requestAnimationFrame(() => this.tick());
  }
}

const scroller = new KineticScroller();

/**
 * Smooth-scrolls the page in the given direction using kinetic momentum.
 * Finds the best scrollable target element on the page.
 *
 * @param {string} direction - 'SCROLL_UP' | 'SCROLL_DOWN' | 'SCROLL_TOP' | 'SCROLL_BOTTOM'.
 */
function handleScroll(direction) {
  const target = getBestScrollTarget();
  const isRoot = target === document.documentElement || target === document.body;

  switch (direction) {
    case 'SCROLL_UP':
      // A single pulse adds 40 initial velocity, decaying at 0.92 friction,
      // traveling a total of exactly 500 pixels. Perfect for one swipe.
      scroller.addVelocity(-40, target, isRoot);
      break;

    case 'SCROLL_DOWN':
      scroller.addVelocity(40, target, isRoot);
      break;

    case 'SCROLL_TOP':
      scroller.velocity = 0; // Cancel momentum
      if (isRoot) window.scrollTo({ top: 0, behavior: 'smooth' });
      else target.scrollTo({ top: 0, behavior: 'smooth' });
      break;

    case 'SCROLL_BOTTOM':
      scroller.velocity = 0; // Cancel momentum
      if (isRoot) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      else target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
      break;

    default:
      log.warn(`Unknown scroll direction: ${direction}`);
  }
}

/**
 * Finds the best scrollable element on the page.
 * Priority:
 *  1. Focused element if scrollable (user is in a scroll container)
 *  2. Largest scrollable element (for complex layouts with sub-scrollers)
 *  3. document.documentElement
 *  4. document.body
 *
 * @returns {Element}
 */
function getBestScrollTarget() {
  // 1. Focused scrollable element
  const focused = document.activeElement;
  if (focused && focused !== document.body && isScrollable(focused)) {
    return focused;
  }

  // 2. Most prominent scrollable element (biggest scrollHeight delta)
  const candidates = Array.from(document.querySelectorAll('*')).filter(isScrollable);
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return candidates[0];
  }

  // 3. Standard fallbacks
  if (isScrollable(document.documentElement)) return document.documentElement;
  if (isScrollable(document.body))            return document.body;

  return document.documentElement;
}

/**
 * Returns true if the element has scrollable overflow content.
 * @param {Element} el
 * @returns {boolean}
 */
function isScrollable(el) {
  if (!el || el.scrollHeight <= el.clientHeight) return false;
  
  // The document element and body can scroll even with overflow: visible
  if (el === document.documentElement || el === document.body) {
    return true;
  }

  const style    = window.getComputedStyle(el);
  const overflow = style.overflow + style.overflowY;
  return /auto|scroll/.test(overflow);
}

// ---------------------------------------------------------------------------
// Text insertion
// ---------------------------------------------------------------------------

/**
 * Inserts dictated text into the currently active element (input/textarea).
 * @param {{ text: string }} payload 
 */
function handleTypeText(payload) {
  const { text } = payload;
  if (!text) return;

  const activeElement = document.activeElement;
  if (!activeElement) {
    HUDManager.show('⚠️ No text field focused', 'voice');
    return;
  }

  // Check if the element accepts text
  const isInput = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA';
  const isContentEditable = activeElement.isContentEditable;

  if (isInput) {
    // Preserve selection (cursor position)
    const start = activeElement.selectionStart || 0;
    const end = activeElement.selectionEnd || 0;
    const val = activeElement.value;
    
    // Insert text and add a space afterwards for natural dictation
    const insert = text + ' ';
    activeElement.value = val.slice(0, start) + insert + val.slice(end);
    
    // Move cursor after the inserted text
    activeElement.selectionStart = activeElement.selectionEnd = start + insert.length;
    
    // Dispatch events for frameworks like React/Vue
    activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    activeElement.dispatchEvent(new Event('change', { bubbles: true }));
    
    HUDManager.show(`⌨️ Typed: "${text}"`, 'voice');
  } else if (isContentEditable) {
    // Basic fallback for contentEditable (e.g. some rich text editors)
    activeElement.focus();
    // Using execCommand is deprecated but it's the only reliable way to insert text 
    // at the cursor in a contentEditable while preserving history/undo in all browsers.
    document.execCommand('insertText', false, text + ' ');
    HUDManager.show(`⌨️ Typed: "${text}"`, 'voice');
  } else {
    HUDManager.show('⚠️ Not a text field', 'voice');
  }
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

installGlobalErrorHandlers(ComponentId.CONTENT);

log.debug('Gesture X content script initialized');

