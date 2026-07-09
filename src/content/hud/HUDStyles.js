/**
 * @fileoverview Gesture X — HUD Styles
 *
 * CSS for the Shadow DOM overlay. Scoped entirely inside the shadow root —
 * zero risk of conflicts with host page styles, and immune to page CSS overrides.
 *
 * Design system:
 *  - Dark glassmorphism: frosted-glass card with blur + translucent background
 *  - Violet → electric-blue accent gradient matching the extension brand
 *  - Micro-animations: spring entrance, smooth exit, progress countdown bar
 *  - pointer-events: none — HUD never intercepts user interaction
 *  - z-index: 2147483647 — highest possible, above all page content
 *
 * @returns {string} CSS text to inject into Shadow DOM <style>.
 */
export const HUD_CSS = `
  /* -----------------------------------------------------------------------
     Reset & host
     ----------------------------------------------------------------------- */
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :host {
    all: initial;
    display: block;
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  /* -----------------------------------------------------------------------
     Toast container — stacks toasts vertically, newest at bottom
     ----------------------------------------------------------------------- */
  #toast-container {
    display: flex;
    flex-direction: column-reverse;
    align-items: flex-end;
    gap: 10px;
  }

  /* -----------------------------------------------------------------------
     Individual toast card
     ----------------------------------------------------------------------- */
  .toast {
    position: relative;
    width: 284px;
    background: rgba(8, 8, 20, 0.90);
    backdrop-filter: blur(24px) saturate(160%);
    -webkit-backdrop-filter: blur(24px) saturate(160%);
    border: 1px solid rgba(124, 58, 237, 0.28);
    border-radius: 18px;
    overflow: hidden;
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset,
      0 0 40px rgba(109, 40, 217, 0.12);
    animation: toast-in 320ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    will-change: transform, opacity;
  }

  .toast.dismissing {
    animation: toast-out 240ms cubic-bezier(0.4, 0, 0.6, 1) forwards;
  }

  /* -----------------------------------------------------------------------
     Entrance / exit animations
     ----------------------------------------------------------------------- */
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(18px) scale(0.94); }
    to   { opacity: 1; transform: translateY(0)    scale(1);    }
  }

  @keyframes toast-out {
    from { opacity: 1; transform: translateY(0)   scale(1);    }
    to   { opacity: 0; transform: translateY(-8px) scale(0.97); }
  }

  /* -----------------------------------------------------------------------
     Toast inner layout
     ----------------------------------------------------------------------- */
  .toast-body {
    display: grid;
    grid-template-columns: 44px 1fr auto;
    grid-template-rows: auto auto;
    column-gap: 12px;
    row-gap: 2px;
    padding: 14px 16px 16px;
    align-items: center;
  }

  /* -----------------------------------------------------------------------
     Icon cell (emoji / SVG)
     ----------------------------------------------------------------------- */
  .toast-icon {
    grid-row: 1 / 3;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(124, 58, 237, 0.15);
    border: 1px solid rgba(124, 58, 237, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    line-height: 1;
    flex-shrink: 0;
  }

  /* -----------------------------------------------------------------------
     Text content
     ----------------------------------------------------------------------- */
  .toast-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(180, 140, 255, 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }

  .toast-command {
    grid-column: 2;
    font-size: 14.5px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.95);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  /* -----------------------------------------------------------------------
     Badge (confidence / hand)
     ----------------------------------------------------------------------- */
  .toast-badge {
    grid-row: 1 / 3;
    align-self: start;
    font-size: 10.5px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.4);
    text-align: right;
    white-space: nowrap;
    line-height: 1.6;
  }

  .toast-badge .hand {
    display: block;
    color: rgba(255, 255, 255, 0.55);
    font-size: 11px;
  }

  /* -----------------------------------------------------------------------
     Progress bar — scaleX countdown
     ----------------------------------------------------------------------- */
  .toast-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 3px;
    background: linear-gradient(
      90deg,
      #7c3aed 0%,
      #6366f1 40%,
      #38bdf8 100%
    );
    transform-origin: left center;
    animation: progress-drain var(--duration) linear forwards;
    border-radius: 0 0 0 0;
  }

  @keyframes progress-drain {
    from { transform: scaleX(1); }
    to   { transform: scaleX(0); }
  }

  /* -----------------------------------------------------------------------
     Voice-specific variant — blue tint instead of violet
     ----------------------------------------------------------------------- */
  .toast.voice .toast-icon {
    background: rgba(56, 189, 248, 0.12);
    border-color: rgba(56, 189, 248, 0.22);
  }

  .toast.voice .toast-label {
    color: rgba(125, 211, 252, 0.85);
  }

  .toast.voice {
    border-color: rgba(56, 189, 248, 0.22);
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset,
      0 0 40px rgba(56, 189, 248, 0.08);
  }

  .toast.voice .toast-progress {
    background: linear-gradient(
      90deg,
      #0ea5e9 0%,
      #38bdf8 50%,
      #7dd3fc 100%
    );
  }

  /* -----------------------------------------------------------------------
     Logo watermark — subtle brand presence
     ----------------------------------------------------------------------- */
  .toast-watermark {
    position: absolute;
    top: 10px;
    right: 12px;
    font-size: 8.5px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: rgba(255, 255, 255, 0.10);
    text-transform: uppercase;
    pointer-events: none;
    user-select: none;
  }
`;
