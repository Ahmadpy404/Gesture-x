/**
 * @fileoverview Central constants for Gesture X.
 * All enums, magic strings, and configuration defaults live here.
 * No other module should define raw string literals for shared concepts.
 */

// ---------------------------------------------------------------------------
// Component identifiers
// ---------------------------------------------------------------------------

/** @enum {string} Identifies which extension component sent a message. */
export const ComponentId = Object.freeze({
  SERVICE_WORKER: 'service_worker',
  OFFSCREEN:      'offscreen',
  CONTENT:        'content',
  POPUP:          'popup',
  SETTINGS:       'settings',
});

// ---------------------------------------------------------------------------
// Message types (typed message bus envelope)
// ---------------------------------------------------------------------------

/** @enum {string} All valid message types in the extension. */
export const MessageType = Object.freeze({
  // Gesture pipeline → SW
  GESTURE_CONFIRMED:   'GESTURE_CONFIRMED',
  GESTURE_DATA:        'GESTURE_DATA',
  // Voice pipeline → SW
  VOICE_COMMAND:       'VOICE_COMMAND',
  TYPE_TEXT:           'TYPE_TEXT',
  // SW → content script
  EXECUTE_SCROLL:      'EXECUTE_SCROLL',
  EXECUTE_DRAG:        'EXECUTE_DRAG',
  SHOW_HUD:            'SHOW_HUD',
  HIDE_HUD:            'HIDE_HUD',
  // SW ↔ popup
  STATUS_UPDATE:       'STATUS_UPDATE',
  TOGGLE_ACTIVE:       'TOGGLE_ACTIVE',
  TOGGLE_GESTURE:      'TOGGLE_GESTURE',
  TOGGLE_VOICE:        'TOGGLE_VOICE',
  GET_STATUS:          'GET_STATUS',
  // SW ↔ settings
  SETTINGS_CHANGED:    'SETTINGS_CHANGED',
  GET_SETTINGS:        'GET_SETTINGS',
  // SW ↔ offscreen
  HAND_TRACKING:       'HAND_TRACKING',
  OFFSCREEN_READY:     'OFFSCREEN_READY',
  OFFSCREEN_ERROR:     'OFFSCREEN_ERROR',
  SW_HEARTBEAT:        'SW_HEARTBEAT',
  START_CAMERA:        'START_CAMERA',
  STOP_CAMERA:         'STOP_CAMERA',
  START_SPEECH:        'START_SPEECH',
  STOP_SPEECH:         'STOP_SPEECH',
  PLAY_BEEP:           'PLAY_BEEP',
});

// ---------------------------------------------------------------------------
// Gesture labels
// ---------------------------------------------------------------------------

/** @enum {string} All recognizable hand gesture labels. */
export const GestureLabel = Object.freeze({
  SWIPE_LEFT:  'SWIPE_LEFT',
  SWIPE_RIGHT: 'SWIPE_RIGHT',
  SWIPE_UP:    'SWIPE_UP',
  SWIPE_DOWN:  'SWIPE_DOWN',
  PEACE:       'PEACE',
  FIST:        'FIST',
  OPEN_PALM:   'OPEN_PALM',
  THUMBS_UP:   'THUMBS_UP',
  THUMBS_DOWN: 'THUMBS_DOWN',
  UNKNOWN:     'UNKNOWN',
});

// ---------------------------------------------------------------------------
// Command IDs
// ---------------------------------------------------------------------------

/** @enum {string} All executable browser commands. */
export const CommandId = Object.freeze({
  // Navigation
  NAV_BACK:           'NAV_BACK',
  NAV_FORWARD:        'NAV_FORWARD',
  NAV_RELOAD:         'NAV_RELOAD',
  NAV_HOME:           'NAV_HOME',
  // Tabs
  TAB_NEW:            'TAB_NEW',
  TAB_CLOSE:          'TAB_CLOSE',
  TAB_NEXT:           'TAB_NEXT',
  TAB_PREV:           'TAB_PREV',
  TAB_REOPEN:         'TAB_REOPEN',
  // Scroll
  SCROLL_UP:          'SCROLL_UP',
  SCROLL_DOWN:        'SCROLL_DOWN',
  SCROLL_TOP:         'SCROLL_TOP',
  SCROLL_BOTTOM:      'SCROLL_BOTTOM',
  DRAG_SCROLL:        'DRAG_SCROLL',
  // Zoom
  ZOOM_IN:            'ZOOM_IN',
  ZOOM_OUT:           'ZOOM_OUT',
  ZOOM_RESET:         'ZOOM_RESET',
  // Window
  WINDOW_FULLSCREEN:  'WINDOW_FULLSCREEN',
  WINDOW_MINIMIZE:    'WINDOW_MINIMIZE',
  // Bookmarks
  BOOKMARK_ADD:       'BOOKMARK_ADD',
  // Text
  TYPE_TEXT:          'TYPE_TEXT',
  // System
  NONE:               'NONE',
});

// ---------------------------------------------------------------------------
// Default gesture → command bindings
// ---------------------------------------------------------------------------

/** Default mapping of gesture labels to command IDs. User-overridable. */
export const DEFAULT_GESTURE_BINDINGS = Object.freeze({
  [GestureLabel.SWIPE_LEFT]:  CommandId.NAV_BACK,
  [GestureLabel.SWIPE_RIGHT]: CommandId.NAV_FORWARD,
  [GestureLabel.SWIPE_UP]:    CommandId.SCROLL_UP,
  [GestureLabel.SWIPE_DOWN]:  CommandId.SCROLL_DOWN,
  [GestureLabel.PEACE]:       CommandId.TAB_NEW,
  [GestureLabel.FIST]:        CommandId.DRAG_SCROLL,
  [GestureLabel.OPEN_PALM]:   CommandId.SCROLL_TOP,
  [GestureLabel.THUMBS_UP]:   CommandId.BOOKMARK_ADD,
  [GestureLabel.THUMBS_DOWN]: CommandId.NAV_RELOAD,
});

// ---------------------------------------------------------------------------
// Default storage values
// ---------------------------------------------------------------------------

/** Default settings written to chrome.storage.local on first install. */
export const DEFAULT_SETTINGS = Object.freeze({
  gestureBindings:  DEFAULT_GESTURE_BINDINGS,
  voiceCommands:    {},   // populated by CommandParser defaults
  sensitivity:      0.7,  // 0.1 – 1.0
  holdDuration:     300,  // ms — how long to hold gesture before confirming
  gestureCooldown:  800,  // ms — minimum time between confirmed gestures
  theme:            'dark',
  enableVoice:      true,
  enableGesture:    true,
  enableVirtualMouse: false, // Virtual Mouse Mode OFF by default
  virtualMouseSpeed: 1.0,
  virtualMouseSmoothing: 0.5,
  virtualMouseClickThreshold: 0.04,
  virtualMouseScrollSpeed: 5.0,
  feedbackAudio:    false,
  feedbackHUD:      true,
  version:          2,    // Bumped version for migration
});

/** Default ephemeral session state. */
export const DEFAULT_SESSION = Object.freeze({
  isActive:       false,
  cameraActive:   false,
  micActive:      false,
  micError:       null,
  cameraError:    null,
  lastGesture:    null,
  lastGestureTs:  0,
  lastVoiceCmd:   null,
  offscreenReady: false,
  swHeartbeat:    0,
});

// ---------------------------------------------------------------------------
// Timing & performance
// ---------------------------------------------------------------------------

export const Timing = Object.freeze({
  SW_HEARTBEAT_INTERVAL_MS:   25_000,  // chrome.alarms interval
  OFFSCREEN_RETRY_DELAY_MS:   500,
  OFFSCREEN_MAX_RETRIES:      3,
  HUD_DISPLAY_DURATION_MS:    2_000,
  SCROLL_STEP_PX:             200,
  SCROLL_SMOOTH_DURATION_MS:  400,
  NOTIFICATION_TIMEOUT_MS:    3_000,
});

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

export const StorageKey = Object.freeze({
  SETTINGS: 'gesture_x_settings',
  SESSION:  'gesture_x_session',
});

// ---------------------------------------------------------------------------
// Offscreen document
// ---------------------------------------------------------------------------

export const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
export const OFFSCREEN_REASONS = ['USER_MEDIA', 'AUDIO_PLAYBACK'];
export const OFFSCREEN_JUSTIFICATION =
  'Gesture X requires an offscreen document to access the camera and microphone ' +
  'via getUserMedia for gesture and voice recognition without blocking page content.';
