# Gesture X — Chrome Extension Architecture & Implementation Plan

> **AI Architect Mode**: Before any code is written, this document critically evaluates the design,
> proposes the optimal architecture, and defines every milestone. This is the single source of truth.

---

## ✅ Approved Decisions

| Decision | Choice | Notes |
|---|---|---|
| Extension Name | **Gesture X** | — |
| Gesture Model | **Rule-based (MediaPipe Landmarks)** | TFLite plugin interface kept for V2 |
| Voice Mode | **Always-On** | Wake-word deferred to V2 |
| Scroll Behavior | **Smooth (eased)** | Premium UX default |
| Target Browsers | **Chrome only** | Edge compat deferred |
| Cloud Voice Fallback | **None for V1** | Web Speech API only |
| Milestone Start | **Milestone 1 immediately** | — |

---

## Executive Summary

**Gesture X** is a production-grade Chrome Extension (Manifest V3) that enables hands-free browser
control through:
- **Hand Gesture Recognition** (MediaPipe Hands via WebAssembly)
- **Voice Command Recognition** (Web Speech API + optional cloud fallback)
- **Browser Automation** (Chrome APIs: tabs, windows, scrolling, navigation, bookmarks, history)
- **Overlay UI** (glassmorphism popup + heads-up display)

---

## Architect's Critical Evaluation & Recommendations

### ⚠️ Design Decisions Requiring Justification

| Issue | Risk | Recommendation |
|---|---|---|
| MediaPipe in Content Script | Blocks page DOM thread | ✅ Run in **offscreen document** (MV3 native) |
| Web Speech API in SW | Not available in Service Workers | ✅ Run in **offscreen document** or content script |
| DOM injection for HUD | XSS surface, style collisions | ✅ Use **Shadow DOM** with `mode: 'closed'` |
| Persistent SW | MV3 SWs are ephemeral | ✅ Use **chrome.alarms** + **chrome.storage** heartbeat |
| Direct camera in popup | Popup unloads on blur | ✅ Camera lives in **offscreen document** only |
| Global state in memory | Lost on SW restart | ✅ All state in **chrome.storage.session** |

### 🏆 Architectural Advantages of This Design
1. **Offscreen Document** = camera + MediaPipe + Speech API live together, away from page DOM
2. **Shadow DOM HUD** = zero style leakage, zero XSS
3. **chrome.storage.session** = fast ephemeral state that survives SW restarts
4. **Message bus pattern** = all components are decoupled, testable independently

---

## Folder Structure

```
gestureflow/
├── manifest.json                    # MV3 manifest
├── package.json                     # Dev tooling only (no bundler dependency at runtime)
├── webpack.config.js                # Bundle for offscreen + content scripts
│
├── src/
│   ├── background/
│   │   ├── service-worker.js        # SW entrypoint (keep-alive, message routing)
│   │   ├── CommandRouter.js         # Routes commands → Chrome API controllers
│   │   ├── TabController.js         # Tab management (open, close, switch, pin)
│   │   ├── WindowController.js      # Window management (snap, fullscreen)
│   │   ├── NavigationController.js  # History back/forward, reload, URL navigation
│   │   ├── BookmarkController.js    # Bookmark create/read
│   │   ├── ScrollController.js      # Injects scroll commands to active tab
│   │   └── KeepAlive.js             # chrome.alarms heartbeat for SW
│   │
│   ├── offscreen/
│   │   ├── offscreen.html           # Minimal shell for offscreen document
│   │   ├── offscreen.js             # Orchestrator for camera + gesture + speech
│   │   ├── camera/
│   │   │   ├── CameraManager.js     # getUserMedia lifecycle, stream management
│   │   │   └── FrameCapture.js      # requestAnimationFrame loop, ImageBitmap
│   │   ├── gesture/
│   │   │   ├── GestureEngine.js     # MediaPipe Hands init + landmark processing
│   │   │   ├── GestureClassifier.js # Landmark → gesture label (rule-based + ML)
│   │   │   ├── GestureDebouncer.js  # Temporal smoothing, hold-to-confirm
│   │   │   └── gestures/            # One file per gesture definition
│   │   │       ├── SwipeLeft.js
│   │   │       ├── SwipeRight.js
│   │   │       ├── SwipeUp.js
│   │   │       ├── SwipeDown.js
│   │   │       ├── Pinch.js
│   │   │       ├── Peace.js
│   │   │       ├── Fist.js
│   │   │       ├── OpenPalm.js
│   │   │       └── Thumbs.js
│   │   └── voice/
│   │       ├── SpeechEngine.js      # Web Speech API wrapper, restarts on error
│   │       ├── CommandParser.js     # NLP-lite: intent extraction from transcript
│   │       └── WakeWordDetector.js  # Optional: "Hey Flow" wake word gating
│   │
│   ├── content/
│   │   ├── content.js               # Thin bridge: receives scroll/HUD commands
│   │   ├── HUDManager.js            # Shadow DOM heads-up display
│   │   ├── ScrollExecutor.js        # smooth scroll with easing
│   │   └── HighlightOverlay.js      # Visual feedback on gesture recognition
│   │
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   ├── popup.css
│   │   └── components/
│   │       ├── StatusCard.js        # Live gesture/voice status
│   │       ├── GestureMap.js        # Visual gesture → command mapping
│   │       ├── Toggle.js            # Enable/disable with animation
│   │       └── PermissionPrompt.js  # Camera/mic permission request UI
│   │
│   ├── settings/
│   │   ├── settings.html
│   │   ├── settings.js
│   │   ├── settings.css
│   │   └── components/
│   │       ├── GestureBindingEditor.js  # Remap gesture → command
│   │       ├── SensitivitySlider.js
│   │       ├── VoiceCommandList.js
│   │       └── ThemeSelector.js
│   │
│   ├── shared/
│   │   ├── constants.js             # All magic strings/numbers centralized
│   │   ├── MessageBus.js            # Typed message send/receive helpers
│   │   ├── StorageManager.js        # Typed wrappers for chrome.storage
│   │   ├── Logger.js                # Structured logging (dev/prod aware)
│   │   ├── ErrorHandler.js          # Global error boundary + reporting
│   │   └── CommandSchema.js         # Zod-lite schema for all commands
│   │
│   └── assets/
│       ├── icons/                   # 16, 32, 48, 128 PNG icons
│       ├── sounds/                  # Optional audio feedback (tiny MP3s)
│       └── mediapipe/               # Vendored WASM + model files (offline)
│
├── tests/
│   ├── unit/
│   │   ├── GestureClassifier.test.js
│   │   ├── CommandParser.test.js
│   │   ├── StorageManager.test.js
│   │   └── CommandRouter.test.js
│   └── e2e/
│       └── extension.test.js        # Puppeteer/Playwright with extension loaded
│
└── dist/                            # Webpack output (what gets packaged)
```

---

## Module Responsibilities

| Module | Responsibility | Boundary |
|---|---|---|
| `service-worker.js` | Message router, Chrome API orchestrator, SW keepalive | No DOM, no camera |
| `offscreen.js` | Camera stream, gesture pipeline, speech pipeline | No Chrome tabs API |
| `content.js` | DOM interaction, HUD, scroll execution | No camera, no SW state |
| `popup.js` | Status display, quick toggles, permission prompts | Read-only to state |
| `settings.js` | Configuration CRUD, gesture binding editor | Writes to storage only |
| `CommandRouter.js` | Maps gesture/voice labels → Chrome API calls | Pure routing logic |
| `GestureEngine.js` | MediaPipe lifecycle, landmark extraction | No command knowledge |
| `GestureClassifier.js` | Landmark arrays → gesture label | Pure math, no I/O |
| `SpeechEngine.js` | Web Speech API lifecycle, error recovery | No command knowledge |
| `CommandParser.js` | Transcript string → command intent | Pure NLP, no I/O |

---

## Data Flow

```
Camera Feed
    │
    ▼
CameraManager (getUserMedia → MediaStream)
    │  ImageBitmap frames at ~30fps
    ▼
GestureEngine (MediaPipe Hands WASM)
    │  NormalizedLandmarkList [21 points × {x,y,z}]
    ▼
GestureClassifier (rule-based + angle math)
    │  GestureLabel (string enum)
    ▼
GestureDebouncer (temporal smoothing, 300ms hold)
    │  ConfirmedGesture event
    ▼
offscreen.js → chrome.runtime.sendMessage({ type: 'GESTURE_COMMAND', gesture })
    │
    ▼
service-worker.js → CommandRouter.route(gesture)
    │
    ▼
TabController / NavigationController / ScrollController
    │                                        │
    ▼                                        ▼
Chrome APIs                     content.js (scroll/HUD)
```

---

## Event Flow

```
USER ACTION
    │
    ├──[gesture]──► GestureEngine ──► GestureClassifier ──► GestureDebouncer
    │                                                              │
    │                                                   GESTURE_CONFIRMED event
    │                                                              │
    └──[voice]───► SpeechEngine ──► CommandParser ──► VOICE_COMMAND event
                                                              │
                                            ┌─────────────────┘
                                            │
                              offscreen.js sendMessage
                                            │
                                    service-worker.js
                                            │
                                    CommandRouter.route()
                                            │
                        ┌───────────────────┼───────────────────┐
                        │                   │                   │
                 TabController      NavController        ScrollController
                        │                   │                   │
                 chrome.tabs.*    chrome.history.*    content.js message
                                                              │
                                                       ScrollExecutor
                                                              │
                                                    window.scrollBy(eased)
```

---

## Browser APIs Used

| API | Purpose | Permission Required |
|---|---|---|
| `chrome.tabs` | Create, close, switch, pin, mute tabs | `tabs` |
| `chrome.windows` | Snap, resize, fullscreen windows | — (implicit) |
| `chrome.history` | Navigate back/forward programmatically | `history` |
| `chrome.bookmarks` | Create, read, search bookmarks | `bookmarks` |
| `chrome.storage.local` | Persistent settings, gesture bindings | `storage` |
| `chrome.storage.session` | Ephemeral runtime state (enabled, active gesture) | `storage` |
| `chrome.offscreen` | Offscreen document for camera+MediaPipe+Speech | `offscreen` |
| `chrome.alarms` | SW keepalive heartbeat | `alarms` |
| `chrome.scripting` | Inject scroll/HUD script into active tab | `scripting` |
| `chrome.notifications` | Status notifications | `notifications` |
| `getUserMedia` | Camera stream (in offscreen doc) | `camera` host permission |
| `SpeechRecognition` | Voice commands (in offscreen doc) | `microphone` host permission |
| `chrome.runtime.sendMessage` | All inter-component communication | — |

---

## Storage Design

### `chrome.storage.local` — Persistent Settings
```typescript
interface LocalSettings {
  gestureBindings: Record<GestureLabel, CommandId>;  // user-remappable
  voiceCommands: Record<string, CommandId>;          // user-defined phrases
  sensitivity: number;                               // 0.1–1.0
  holdDuration: number;                              // ms, default 300
  theme: 'dark' | 'light' | 'system';
  enableVoice: boolean;
  enableGesture: boolean;
  wakeWord: string | null;                           // null = always-on
  feedbackAudio: boolean;
  feedbackHUD: boolean;
  version: number;                                   // storage schema version
}
```

### `chrome.storage.session` — Ephemeral Runtime State
```typescript
interface SessionState {
  isActive: boolean;                 // global on/off
  cameraActive: boolean;
  micActive: boolean;
  lastGesture: GestureLabel | null;
  lastGestureTime: number;           // timestamp
  lastVoiceCommand: string | null;
  offscreenReady: boolean;
  swHeartbeat: number;               // timestamp of last SW ping
}
```

---

## Permission Flow

```
First Install
    │
    ▼
popup.html shown → PermissionPrompt component
    │
    ├── Request camera: navigator.mediaDevices.getUserMedia({video: true})
    │   [Chrome shows native camera permission dialog]
    │
    └── Request mic: navigator.mediaDevices.getUserMedia({audio: true})
        [Chrome shows native mic permission dialog]
            │
            ▼
    Permissions granted → stored in session state
            │
            ▼
    offscreen document created (chrome.offscreen.createDocument)
            │
            ▼
    CameraManager.start() → stream acquired
    SpeechEngine.start() → recognition started
```

---

## Gesture Pipeline

```
Frame (ImageBitmap) @ 30fps
    │
    ▼
MediaPipe Hands.send(frame)
    │
    ▼
Results: { landmarks: [21 × {x,y,z}], handedness: 'Left'|'Right' }
    │
    ▼
GestureClassifier.classify(landmarks)
    ├── FingerStateDetector  → [thumb, index, middle, ring, pinky]: boolean[]
    ├── AngleCalculator      → joint angles for each finger
    ├── VelocityTracker      → dx/dy from last N frames for swipe detection
    └── GestureRules[]       → rule matching → GestureLabel | null
    │
    ▼
GestureDebouncer
    ├── Requires same label for holdDuration ms (default 300ms)
    ├── Cooldown: 800ms between confirmed gestures (prevents spam)
    └── Emits: { label, confidence, timestamp, hand }
    │
    ▼
Confirmed GestureEvent → sendMessage to SW
```

---

## Voice Pipeline

```
SpeechEngine (SpeechRecognition API, continuous=true, interimResults=true)
    │
    ├── WakeWordDetector (if configured)
    │   └── listens for wake phrase → activates command window (3s)
    │
    ▼
onresult: SpeechRecognitionResult
    │
    ▼
CommandParser.parse(transcript)
    ├── Normalize: lowercase, trim, remove filler words
    ├── Intent matching: keyword tree (no external NLP dependency)
    │   ├── "go back" / "back" → NAV_BACK
    │   ├── "new tab" / "open tab" → TAB_NEW
    │   ├── "scroll down" / "down" → SCROLL_DOWN
    │   └── ... (50+ built-in phrases)
    └── Returns: { command: CommandId, confidence: number } | null
    │
    ▼
VoiceCommandEvent → sendMessage to SW
```

---

## UI Flow

```
Extension Icon Clicked
    │
    ▼
popup.html opens (400×560px, fixed)
    ├── StatusCard: shows camera/mic/gesture status
    ├── Toggle: enable/disable gestures & voice
    ├── GestureMap: shows current gesture → command bindings
    ├── [Settings] button → opens settings.html in new tab
    └── [Camera Preview] toggle → shows small preview from offscreen

settings.html (full tab, 1024×768 min)
    ├── GestureBindingEditor: drag-and-drop remapping
    ├── SensitivitySlider
    ├── VoiceCommandList: view/edit/delete voice phrases
    ├── ThemeSelector
    └── [Export / Import] config as JSON

HUD (injected into active tab via content.js, Shadow DOM)
    ├── Top-right corner overlay, 200×80px
    ├── Shows: last recognized gesture/voice command
    ├── Animates in/out with CSS transitions
    └── Auto-dismisses after 2s
```

---

## Inter-Component Communication

All messages use a **typed message bus** with this envelope:
```typescript
interface Message {
  type: MessageType;      // string enum
  payload: unknown;       // typed per MessageType
  source: ComponentId;    // 'offscreen' | 'content' | 'popup' | 'settings'
  timestamp: number;
  requestId?: string;     // for request-response pairs
}
```

### Message Types
| Message | From → To | Payload |
|---|---|---|
| `GESTURE_CONFIRMED` | offscreen → SW | `{ label, confidence, hand, timestamp }` |
| `VOICE_COMMAND` | offscreen → SW | `{ command, transcript, confidence }` |
| `EXECUTE_SCROLL` | SW → content | `{ direction, amount, easing }` |
| `SHOW_HUD` | SW → content | `{ text, type, duration }` |
| `STATUS_UPDATE` | SW → popup | `{ cameraActive, micActive, lastGesture }` |
| `TOGGLE_ACTIVE` | popup → SW | `{ active: boolean }` |
| `SETTINGS_CHANGED` | settings → SW | `{ key, value }` |
| `OFFSCREEN_READY` | offscreen → SW | `{}` |
| `SW_HEARTBEAT` | SW → offscreen | `{ timestamp }` |
| `REQUEST_FRAME` | offscreen → content | `{}` (for HUD preview) |

---

## Milestones

### Milestone 1 — Chrome Extension Skeleton ✅ Runnable
- `manifest.json` (MV3, all permissions declared)
- `service-worker.js` (keepalive, message bus setup)
- `popup.html/js/css` (static UI shell, no functionality)
- `settings.html/js/css` (static UI shell)
- `content.js` (empty message listener)
- `shared/` (constants, Logger, StorageManager, MessageBus)
- **Verify**: Extension loads, popup opens, no console errors

### Milestone 2 — Offscreen Document + Camera ✅ Runnable
- `offscreen.html/js` (document created/destroyed by SW)
- `CameraManager.js` (getUserMedia, stream lifecycle)
- `FrameCapture.js` (rAF loop, ImageBitmap)
- Permission prompt in popup
- **Verify**: Camera light turns on, frames captured, no memory leak

### Milestone 3 — Gesture Recognition ✅ Runnable
- `GestureEngine.js` (MediaPipe Hands WASM loaded offline)
- `GestureClassifier.js` (full rule-based classifier)
- All 9 gesture definitions
- `GestureDebouncer.js`
- Gesture events sent to SW, logged
- **Verify**: All 9 gestures recognized with <100ms latency

### Milestone 4 — Voice Recognition ✅ Runnable
- `SpeechEngine.js` (Web Speech API, auto-restart)
- `CommandParser.js` (50+ built-in phrases)
- `WakeWordDetector.js`
- Voice commands sent to SW, logged
- **Verify**: "new tab", "go back", "scroll down" all recognized

### Milestone 5 — Browser Controller ✅ Runnable
- `CommandRouter.js`
- `TabController.js`, `WindowController.js`, `NavigationController.js`
- `BookmarkController.js`, `ScrollController.js`
- `content.js` → `ScrollExecutor.js`, `HUDManager.js` (Shadow DOM)
- **Verify**: All gestures/voice commands execute correct Chrome API calls

### Milestone 6 — UI Polish ✅ Shippable
- Glassmorphism popup redesign
- Settings page full implementation (GestureBindingEditor)
- HUD animations, audio feedback
- Dark/light/system theme
- Micro-interactions, transitions
- **Verify**: UI matches premium design spec

### Milestone 7 — Testing & Chrome Store Prep ✅ Production
- Unit tests for GestureClassifier, CommandParser, StorageManager
- E2E test with Puppeteer
- Security audit (CSP, permissions minimization)
- Performance profiling (memory, CPU)
- Manifest validation, icons, screenshots, description, privacy policy
- `README.md`, packaging script
- **Verify**: Passes Chrome Web Store automated review checklist

---

## Security Architecture

- **CSP**: `"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }`
- **No remote code execution**: MediaPipe WASM vendored locally
- **Shadow DOM HUD**: `mode: 'closed'` prevents external JS access
- **Input sanitization**: All messages validated against `CommandSchema.js` before processing
- **Least privilege**: `host_permissions` limited to `<all_urls>` only for content script injection (required for HUD/scroll)
- **No analytics or external requests** in production build
- **Camera/mic accessed only in offscreen document**, never in content scripts

---

## Performance Targets

| Metric | Target |
|---|---|
| Gesture recognition latency | < 100ms end-to-end |
| Frame processing overhead | < 5% of page CPU |
| SW message round-trip | < 20ms |
| Popup open time | < 200ms |
| Memory footprint (offscreen) | < 150MB (MediaPipe WASM) |
| Content script overhead | < 1MB, < 0.5% CPU |

---

## TFLite Plugin Interface (V2 Readiness)

The `GestureClassifier.js` will expose a strategy interface so a TFLite model can be dropped in:

```js
// GestureClassifier.js — strategy pattern
class GestureClassifier {
  constructor(strategy = new RuleBasedStrategy()) {
    this.strategy = strategy;  // swap to TFLiteStrategy() in V2
  }
  classify(landmarks) { return this.strategy.classify(landmarks); }
}

class RuleBasedStrategy { classify(landmarks) { /* V1 */ } }
class TFLiteStrategy    { classify(landmarks) { /* V2 */ } }  // stub only
```

No other module needs to change when TFLite is introduced.
