/**
 * @fileoverview Gesture X Settings Page — full M6 controller.
 *
 * Responsibilities:
 *  1. Load settings from SW (GET_SETTINGS) on startup.
 *  2. Render all form sections: toggles, sliders, gesture bindings, voice cheatsheet.
 *  3. Save any change immediately via SETTINGS_CHANGED message to SW.
 *  4. Debounce slider saves (500ms) to avoid excessive storage writes.
 *  5. Populate stat tiles (gestures count, voice commands count).
 *  6. Export / import config as JSON.
 *  7. Reset to defaults with confirmation.
 */

import { sendToRuntimeWithResponse, sendToRuntime } from '../shared/MessageBus.js';
import { installGlobalErrorHandlers, safeAsync }    from '../shared/ErrorHandler.js';
import {
  MessageType, ComponentId,
  GestureLabel, CommandId, DEFAULT_GESTURE_BINDINGS,
} from '../shared/constants.js';
import { createLogger } from '../shared/Logger.js';

const log = createLogger('Settings');

// ---------------------------------------------------------------------------
// Display maps
// ---------------------------------------------------------------------------

/** @type {Record<string, { label: string, icon: string }>} */
const GESTURE_META = {
  [GestureLabel.SWIPE_LEFT]:  { label: 'Swipe Left',   icon: '←'  },
  [GestureLabel.SWIPE_RIGHT]: { label: 'Swipe Right',  icon: '→'  },
  [GestureLabel.SWIPE_UP]:    { label: 'Swipe Up',     icon: '↑'  },
  [GestureLabel.SWIPE_DOWN]:  { label: 'Swipe Down',   icon: '↓'  },
  [GestureLabel.PINCH]:       { label: 'Pinch',        icon: '🤌' },
  [GestureLabel.PEACE]:       { label: 'Peace',        icon: '✌️' },
  [GestureLabel.FIST]:        { label: 'Fist',         icon: '✊' },
  [GestureLabel.OPEN_PALM]:   { label: 'Open Palm',    icon: '🖐' },
  [GestureLabel.THUMBS_UP]:   { label: 'Thumbs Up',    icon: '👍' },
  [GestureLabel.THUMBS_DOWN]: { label: 'Thumbs Down',  icon: '👎' },
};

/** @type {Record<string, string>} */
const COMMAND_NAMES = {
  [CommandId.NONE]:              '— None —',
  [CommandId.NAV_BACK]:          'Back',
  [CommandId.NAV_FORWARD]:       'Forward',
  [CommandId.NAV_RELOAD]:        'Reload',
  [CommandId.NAV_HOME]:          'Home',
  [CommandId.TAB_NEW]:           'New Tab',
  [CommandId.TAB_CLOSE]:         'Close Tab',
  [CommandId.TAB_NEXT]:          'Next Tab',
  [CommandId.TAB_PREV]:          'Previous Tab',
  [CommandId.TAB_REOPEN]:        'Reopen Tab',
  [CommandId.SCROLL_UP]:         'Scroll Up',
  [CommandId.SCROLL_DOWN]:       'Scroll Down',
  [CommandId.SCROLL_TOP]:        'Scroll to Top',
  [CommandId.SCROLL_BOTTOM]:     'Scroll to Bottom',
  [CommandId.DRAG_SCROLL]:       'Continuous Drag Scroll',
  [CommandId.ZOOM_IN]:           'Zoom In',
  [CommandId.ZOOM_OUT]:          'Zoom Out',
  [CommandId.ZOOM_RESET]:        'Reset Zoom',
  [CommandId.WINDOW_FULLSCREEN]: 'Fullscreen',
  [CommandId.WINDOW_MINIMIZE]:   'Minimize Window',
  [CommandId.BOOKMARK_ADD]:      'Bookmark Page',
};

/** Commands grouped for the <select> optgroups. */
const COMMAND_GROUPS = [
  { label: 'None',       ids: [CommandId.NONE] },
  { label: 'Navigation', ids: [CommandId.NAV_BACK, CommandId.NAV_FORWARD, CommandId.NAV_RELOAD, CommandId.NAV_HOME] },
  { label: 'Tabs',       ids: [CommandId.TAB_NEW, CommandId.TAB_CLOSE, CommandId.TAB_NEXT, CommandId.TAB_PREV, CommandId.TAB_REOPEN] },
  { label: 'Scroll',     ids: [CommandId.SCROLL_UP, CommandId.SCROLL_DOWN, CommandId.SCROLL_TOP, CommandId.SCROLL_BOTTOM, CommandId.DRAG_SCROLL] },
  { label: 'Zoom',       ids: [CommandId.ZOOM_IN, CommandId.ZOOM_OUT, CommandId.ZOOM_RESET] },
  { label: 'Window',     ids: [CommandId.WINDOW_FULLSCREEN, CommandId.WINDOW_MINIMIZE] },
  { label: 'Bookmarks',  ids: [CommandId.BOOKMARK_ADD] },
];

const VOICE_COMMAND_GROUPS = [
  {
    label: 'Navigation',
    items: [
      { phrase: 'back',                command: CommandId.NAV_BACK     },
      { phrase: 'forward',             command: CommandId.NAV_FORWARD  },
      { phrase: 'reload',              command: CommandId.NAV_RELOAD   },
      { phrase: 'home',                command: CommandId.NAV_HOME     },
    ],
  },
  {
    label: 'Tabs',
    items: [
      { phrase: 'new',                 command: CommandId.TAB_NEW      },
      { phrase: 'close',               command: CommandId.TAB_CLOSE    },
      { phrase: 'next tab',            command: CommandId.TAB_NEXT     },
      { phrase: 'previous tab',        command: CommandId.TAB_PREV     },
      { phrase: 'reopen tab',          command: CommandId.TAB_REOPEN   },
    ],
  },
  {
    label: 'Scroll',
    items: [
      { phrase: 'scroll down',         command: CommandId.SCROLL_DOWN  },
      { phrase: 'scroll up',           command: CommandId.SCROLL_UP    },
      { phrase: 'scroll to top',       command: CommandId.SCROLL_TOP   },
      { phrase: 'scroll to bottom',    command: CommandId.SCROLL_BOTTOM },
    ],
  },
  {
    label: 'Zoom',
    items: [
      { phrase: 'zoom in',             command: CommandId.ZOOM_IN      },
      { phrase: 'zoom out',            command: CommandId.ZOOM_OUT     },
      { phrase: 'reset zoom',          command: CommandId.ZOOM_RESET   },
    ],
  },
  {
    label: 'Window & More',
    items: [
      { phrase: 'fullscreen',          command: CommandId.WINDOW_FULLSCREEN },
      { phrase: 'minimize',            command: CommandId.WINDOW_MINIMIZE   },
      { phrase: 'bookmark this',       command: CommandId.BOOKMARK_ADD      },
    ],
  },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {object | null} */
let currentSettings = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let sliderSaveTimer = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  installGlobalErrorHandlers(ComponentId.SETTINGS);
  setupNavigation();
  setupSliders();
  setupResetButton();
  setupAboutLinks();
  await loadAndRenderSettings();
  log.info('Settings page initialized');
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.settings-section');

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.section;

      navItems.forEach((n) => {
        n.classList.remove('active');
        n.removeAttribute('aria-current');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');

      sections.forEach((s) => {
        const isTarget = s.id === `section-${target}`;
        s.classList.toggle('active', isTarget);
        s.hidden = !isTarget;
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Settings load & render
// ---------------------------------------------------------------------------

async function loadAndRenderSettings() {
  const result = await safeAsync(
    () => sendToRuntimeWithResponse(MessageType.GET_SETTINGS, null, ComponentId.SETTINGS),
    'settings:load'
  );

  if (!result?.settings) {
    log.warn('Could not load settings from SW — falling back to chrome.storage');
    // Fallback: read directly from storage
    const stored = await chrome.storage.sync.get('settings');
    currentSettings = stored.settings ?? {};
  } else {
    currentSettings = result.settings;
  }

  renderSettings(currentSettings);
}

/**
 * Renders all settings UI elements from a settings object.
 * @param {object} settings
 */
function renderSettings(settings) {
  // ---- Toggle checkboxes ----
  [
    ['s-gesture-toggle', 'enableGesture'],
    ['s-voice-toggle',   'enableVoice'  ],
    ['s-hud-toggle',     'feedbackHUD'  ],
    ['s-audio-toggle',   'feedbackAudio'],
    ['s-virtual-mouse-toggle', 'enableVirtualMouse'],
  ].forEach(([id, key]) => {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
    if (!el) return;
    el.checked = !!settings[key];
    el.setAttribute('aria-checked', String(el.checked));
    // Remove old listener by cloning, then re-attach
    const fresh = el.cloneNode(true);
    el.replaceWith(fresh);
    fresh.addEventListener('change', () => {
      saveSetting(key, /** @type {HTMLInputElement} */(fresh).checked);
    });
  });

  // ---- Sensitivity slider ----
  const sensPct = Math.round((settings.sensitivity ?? 0.7) * 100);
  setSlider('sensitivity-slider', 'sensitivity-value', sensPct, '%');

  // ---- Hold Duration slider ----
  setSlider('hold-slider', 'hold-value', settings.holdDuration ?? 300, 'ms');

  // ---- Cooldown slider ----
  setSlider('cooldown-slider', 'cooldown-value', settings.gestureCooldown ?? 800, 'ms');

  // ---- Virtual Mouse Mode sliders ----
  setSlider('mouse-speed-slider', 'mouse-speed-value', (settings.virtualMouseSpeed ?? 1.0) * 10, 'x', v => (v / 10).toFixed(1));
  setSlider('mouse-smooth-slider', 'mouse-smooth-value', (settings.virtualMouseSmoothing ?? 0.5) * 100, '%', v => v);
  setSlider('mouse-scroll-slider', 'mouse-scroll-value', (settings.virtualMouseScrollSpeed ?? 5.0) * 10, 'x', v => (v / 10).toFixed(1));

  // ---- Theme radio ----
  document.querySelectorAll('[name="theme"]').forEach((input) => {
    /** @type {HTMLInputElement} */(input).checked = input.value === (settings.theme ?? 'dark');
    input.addEventListener('change', () => {
      if (/** @type {HTMLInputElement} */(input).checked) {
        saveSetting('theme', input.value);
        showToast(`Theme: ${input.value}`, 'success');
      }
    });
  });

  // ---- Gesture bindings ----
  renderGestureBindings(settings.gestureBindings ?? DEFAULT_GESTURE_BINDINGS);

  // ---- Voice commands cheatsheet ----
  renderVoiceCommands();

  // ---- Stat tiles ----
  renderStats();

  // ---- About version ----
  const versionEl = document.getElementById('about-version');
  if (versionEl) {
    const manifest = chrome.runtime.getManifest();
    versionEl.textContent = `Version ${manifest.version}`;
  }
}

// ---------------------------------------------------------------------------
// Gesture bindings
// ---------------------------------------------------------------------------

/**
 * Renders the gesture binding table.
 * @param {Record<string, string>} bindings
 */
function renderGestureBindings(bindings) {
  const container = document.getElementById('gesture-bindings-card');
  if (!container) return;

  container.innerHTML = '';

  // Build grouped option HTML once
  const optGroupsHtml = COMMAND_GROUPS.map(({ label, ids }) => `
    <optgroup label="${label}">
      ${ids.map((id) => `<option value="${id}">${COMMAND_NAMES[id] ?? id}</option>`).join('')}
    </optgroup>
  `).join('');

  Object.entries(GESTURE_META).forEach(([gestureLabel, { label, icon }], i) => {
    if (i > 0) {
      const div = document.createElement('div');
      div.className = 'card-divider';
      container.appendChild(div);
    }

    const currentCommand = bindings[gestureLabel] ?? CommandId.NONE;
    const row = document.createElement('div');
    row.className = 'gesture-binding-row';

    row.innerHTML = `
      <span class="gesture-name">
        <span class="gesture-icon-chip" aria-hidden="true">${icon}</span>
        ${label}
      </span>
      <span class="gesture-arrow" aria-hidden="true">→</span>
      <select
        class="command-select"
        id="binding-${gestureLabel}"
        aria-label="${label} command binding"
        data-gesture="${gestureLabel}"
      >${optGroupsHtml}</select>
    `;

    container.appendChild(row);

    const select = /** @type {HTMLSelectElement} */ (row.querySelector('select'));
    select.value = currentCommand;
    select.addEventListener('change', () => updateGestureBinding(gestureLabel, select.value));
  });
}

/**
 * Updates a single gesture binding and shows feedback.
 * @param {string} gestureLabel
 * @param {string} commandId
 */
async function updateGestureBinding(gestureLabel, commandId) {
  if (!currentSettings) return;
  const newBindings = { ...currentSettings.gestureBindings, [gestureLabel]: commandId };
  await saveSetting('gestureBindings', newBindings);
  currentSettings.gestureBindings = newBindings;
  const gestureName = GESTURE_META[gestureLabel]?.label ?? gestureLabel;
  const commandName = COMMAND_NAMES[commandId] ?? commandId;
  showToast(`${gestureName} → ${commandName}`, 'success');
}

// ---------------------------------------------------------------------------
// Voice commands cheatsheet
// ---------------------------------------------------------------------------

function renderVoiceCommands() {
  const container = document.getElementById('voice-commands-card');
  if (!container) return;

  container.innerHTML = '';

  VOICE_COMMAND_GROUPS.forEach(({ label, items }) => {
    // Category header
    const header = document.createElement('div');
    header.className = 'voice-category-header';
    header.textContent = label;
    container.appendChild(header);

    items.forEach(({ phrase, command }, i) => {
      if (i > 0) {
        const div = document.createElement('div');
        div.className = 'card-divider';
        container.appendChild(div);
      }

      const row = document.createElement('div');
      row.className = 'voice-cmd-row';
      row.innerHTML = `
        <span class="voice-phrase">"${phrase}"</span>
        <span class="voice-arrow" aria-hidden="true">→</span>
        <span class="voice-command-name">${COMMAND_NAMES[command] ?? command}</span>
      `;
      container.appendChild(row);
    });
  });
}

// ---------------------------------------------------------------------------
// Stat tiles
// ---------------------------------------------------------------------------

function renderStats() {
  const gestureCount = Object.keys(GESTURE_META).length;
  const voiceCount   = VOICE_COMMAND_GROUPS.reduce((sum, g) => sum + g.items.length, 0);
  const commandCount = Object.keys(COMMAND_NAMES).length - 1; // exclude NONE

  const setTile = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setTile('stat-gestures',  gestureCount);
  setTile('stat-voice',     voiceCount);
  setTile('stat-commands',  commandCount);
}

// ---------------------------------------------------------------------------
// Sliders — setup and interaction
// ---------------------------------------------------------------------------

function setupSliders() {
  // Sensitivity 10–100 → stored as 0.1–1.0
  setupSliderInteraction('sensitivity-slider', 'sensitivity-value',
    (raw) => {
      const label = sensitivityLabel(raw);
      debouncedSave('sensitivity', raw / 100);
      return `${raw}%`;
    },
    (raw) => `${raw}% — ${sensitivityLabel(raw)}`
  );

  // Hold Duration 100–1000ms
  setupSliderInteraction('hold-slider', 'hold-value',
    (raw) => { debouncedSave('holdDuration', raw); return `${raw}ms`; },
    (raw) => `${raw} milliseconds — ${holdLabel(raw)}`
  );

  // Cooldown 300–2000ms
  setupSliderInteraction('cooldown-slider', 'cooldown-value',
    (raw) => { debouncedSave('gestureCooldown', raw); return `${raw}ms`; },
    (raw) => `${raw} milliseconds`
  );

  // Virtual Mouse Speed 1-50 (mapped to 0.1 - 5.0x)
  setupSliderInteraction('mouse-speed-slider', 'mouse-speed-value',
    (raw) => { 
      const val = raw / 10;
      debouncedSave('virtualMouseSpeed', val); 
      return `${val.toFixed(1)}x`; 
    },
    (raw) => `${(raw / 10).toFixed(1)} times`
  );

  // Virtual Mouse Smoothing 0-99 (mapped to 0.0 - 0.99)
  setupSliderInteraction('mouse-smooth-slider', 'mouse-smooth-value',
    (raw) => { 
      debouncedSave('virtualMouseSmoothing', raw / 100); 
      return `${raw}%`; 
    },
    (raw) => `${raw} percent`
  );

  // Virtual Mouse Scroll Speed 1-100 (mapped to 0.1 - 10.0x)
  setupSliderInteraction('mouse-scroll-slider', 'mouse-scroll-value',
    (raw) => { 
      const val = raw / 10;
      debouncedSave('virtualMouseScrollSpeed', val); 
      return `${val.toFixed(1)}x`; 
    },
    (raw) => `${(raw / 10).toFixed(1)} times`
  );
}

/**
 * @param {string} sliderId
 * @param {string} badgeId
 * @param {function(number): string} formatter   - Returns badge text.
 * @param {function(number): string} [ariaFormatter] - Returns aria-valuetext.
 */
function setupSliderInteraction(sliderId, badgeId, formatter, ariaFormatter) {
  const slider = /** @type {HTMLInputElement} */ (document.getElementById(sliderId));
  const badge  = document.getElementById(badgeId);
  if (!slider || !badge) return;

  const update = () => {
    const val  = Number(slider.value);
    const min  = Number(slider.min);
    const max  = Number(slider.max);
    const pct  = ((val - min) / (max - min)) * 100;

    // Update gradient fill via CSS custom property
    slider.style.setProperty('--pct', String(pct));

    badge.textContent = formatter(val);
    slider.setAttribute('aria-valuenow',  String(val));
    slider.setAttribute('aria-valuetext', (ariaFormatter ?? formatter)(val));
  };

  slider.addEventListener('input', update);
  // Initialize gradient on page load
  update();
}

/**
 * Sets a slider to a value and syncs badge.
 * @param {string} sliderId
 * @param {string} badgeId
 * @param {number} value
 * @param {string} unit
 * @param {function(number): string|number} [formatter]
 */
function setSlider(sliderId, badgeId, value, unit, formatter = v => v) {
  const slider = /** @type {HTMLInputElement} */ (document.getElementById(sliderId));
  const badge  = document.getElementById(badgeId);
  if (!slider || !badge) return;

  slider.value        = String(value);
  badge.textContent   = `${formatter(value)}${unit}`;

  const min = Number(slider.min);
  const max = Number(slider.max);
  const pct = ((value - min) / (max - min)) * 100;
  slider.style.setProperty('--pct', String(pct));
  slider.setAttribute('aria-valuenow',  String(value));
  slider.setAttribute('aria-valuetext', `${formatter(value)}${unit}`);
}

/** @param {number} pct */
function sensitivityLabel(pct) {
  if (pct <= 30) return 'Very Low';
  if (pct <= 50) return 'Low';
  if (pct <= 70) return 'Medium';
  if (pct <= 85) return 'High';
  return 'Very High';
}

/** @param {number} ms */
function holdLabel(ms) {
  if (ms <= 150) return 'Instant';
  if (ms <= 300) return 'Quick';
  if (ms <= 550) return 'Normal';
  return 'Deliberate';
}

// ---------------------------------------------------------------------------
// Save helpers
// ---------------------------------------------------------------------------

/**
 * Saves a single setting key to the service worker.
 * @param {string} key
 * @param {unknown} value
 */
async function saveSetting(key, value) {
  if (currentSettings) {
    currentSettings[key] = value;
  }
  await safeAsync(
    () => sendToRuntime(
      MessageType.SETTINGS_CHANGED,
      { key, value },
      ComponentId.SETTINGS
    ),
    `settings:save:${key}`
  );
  log.debug(`Saved: ${key} =`, value);
}

/**
 * Debounced version for sliders — waits 500ms after last change before saving.
 * @param {string} key
 * @param {unknown} value
 */
function debouncedSave(key, value) {
  if (currentSettings) currentSettings[key] = value;

  if (sliderSaveTimer !== null) clearTimeout(sliderSaveTimer);

  sliderSaveTimer = setTimeout(async () => {
    sliderSaveTimer = null;
    await saveSetting(key, value);
    showToast('Settings saved', 'success');
  }, 500);
}

// ---------------------------------------------------------------------------
// Reset button
// ---------------------------------------------------------------------------

function setupResetButton() {
  const btn = document.getElementById('reset-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Reset all Gesture X settings to factory defaults?\nThis cannot be undone.'
    );
    if (!confirmed) return;

    await safeAsync(
      () => sendToRuntime(
        MessageType.SETTINGS_CHANGED,
        { key: '__RESET__', value: true },
        ComponentId.SETTINGS
      ),
      'settings:reset'
    );
    await loadAndRenderSettings();
    showToast('Settings reset to defaults', 'success');
  });
}

// ---------------------------------------------------------------------------
// About — export / import
// ---------------------------------------------------------------------------

function setupAboutLinks() {
  document.getElementById('export-config-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!currentSettings) return;

    const blob = new Blob([JSON.stringify(currentSettings, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'gesture-x-config.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Config exported', 'success');
  });

  document.getElementById('import-config-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text     = await file.text();
        const imported = JSON.parse(text);
        for (const [key, value] of Object.entries(imported)) {
          await saveSetting(key, value);
        }
        await loadAndRenderSettings();
        showToast('Config imported successfully', 'success');
      } catch {
        showToast('Import failed — invalid JSON', 'error');
      }
    });
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Page toast (save/error feedback)
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof setTimeout> | null} */
let toastTimer = null;

/**
 * Shows a temporary toast notification at the bottom of the page.
 * @param {string} message
 * @param {'success' | 'error' | ''} [type]
 */
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
    toast.classList.remove('show');
    // Allow re-animation via rAF
    requestAnimationFrame(() => requestAnimationFrame(() => render()));
  } else {
    render();
  }

  function render() {
    toast.textContent = message;
    toast.className   = `toast${type ? ' ' + type : ''}`;
    void toast.offsetWidth; // force reflow
    toast.classList.add('show');
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      toastTimer = null;
    }, 2_800);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', init);
