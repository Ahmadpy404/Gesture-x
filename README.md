# Gesture X 🚀

**Gesture X** is a modern, privacy-first Chrome Extension that enables completely hands-free browser and system control. It leverages **MediaPipe** for hand tracking, the **Web Speech API** for voice commands, and a **Python Native Messaging Host** to give you a system-wide Virtual Mouse.

---

## ✨ Features

- **🤲 Hand Gesture Control:** Scroll, switch tabs, navigate back/forward, and more using simple hand gestures.
- **🎙️ Voice Commands:** Navigate the web with short, highly responsive voice commands (e.g., "Back", "New", "Close").
- **🖱️ Virtual Mouse:** Control your actual computer cursor using your index finger, with complete click and drag support!
- **🔒 Privacy First:** All video and audio processing happens entirely locally on your device. No data is sent to external servers.
- **⚙️ Fully Customizable:** Remap gestures, adjust virtual mouse sensitivity, and toggle features on/off in the Settings UI.

---

## 🖐️ Hand Gestures

Gesture X supports several hand shapes out-of-the-box. You can bind these to any browser action (like scrolling or changing tabs) in the extension's Settings page.

- **Swipe Left / Right / Up / Down** (Hand movement)
- **Peace Sign** ✌️
- **Open Palm** 🖐️
- **Thumbs Up / Down** 👍 👎
- **Fist** ✊
- **Pinch** 🤌

---

## 🖱️ Virtual Mouse Controls

When the **Virtual Mouse** is enabled in Settings, the Python backend takes over to move your actual OS cursor.

| Action | Gesture to use |
| :--- | :--- |
| **Move Cursor** | Move your open hand or index finger. |
| **Left Click** | **Pinch** (Bring thumb and index finger together). |
| **Right Click** | **Fist** (Closed hand). |
| **Double Click**| **Thumbs Up** (Thumb pointing up). |
| **Drag & Drop** | **Three Fingers** (Index, Middle, Ring extended). |
| **Scroll** | **Peace Sign** ✌️ + Move hand Up/Down. |
| **Pause/Freeze**| **Open Palm** 🖐️ (Holds cursor in place). |

---

## 🗣️ Voice Commands

Voice control is highly forgiving and accurate. Just say the word!

- **Navigation:** `Back`, `Forward`, `Reload`, `Home`
- **Tabs:** `New`, `Close`, `Next tab`, `Previous tab`, `Reopen tab`
- **Scrolling:** `Scroll down`, `Scroll up`, `Scroll to top`, `Scroll to bottom`
- **Zooming:** `Zoom in`, `Zoom out`, `Reset zoom`
- **System:** `Fullscreen`, `Minimize`, `Bookmark this`

---

## 🛠️ Architecture

- **Extension (JS):** Built specifically for Manifest V3. It leverages the `chrome.offscreen` API to keep camera and microphone processing alive in the background without blocking your active tabs.
- **Native Host (Python):** Communicates with the extension via Chrome's Native Messaging API to execute system-level mouse commands (using `ctypes` on Windows).

---

## 🚀 Installation & Setup

### 1. Install the Extension
1. Clone this repository.
2. Run `npm install` and then `npm run setup` to download the required ML models.
3. Open Chrome and go to `chrome://extensions/`.
4. Enable **Developer mode** in the top right.
5. Click **Load unpacked** and select the `gesture-x` folder.

### 2. Install the Native Messaging Host (Virtual Mouse)
Because browser extensions cannot control the OS mouse directly, you must install the Python host:
1. Ensure Python 3.10+ is installed on your Windows PC.
2. Open a terminal in `src/python_backend/`.
3. Run `pip install -r requirements.txt`.
4. Run `python install_host.py` (This registers the script with Chrome).

### 3. Start Browsing!
Click the Gesture X icon in your Chrome toolbar to turn it on, tweak your settings, and go hands-free!

---

## 🧪 Development & Testing

```bash
# Run Unit Tests (Jest)
npm run test

# Run End-to-End Tests (Puppeteer)
npm run test:e2e

# Package for Chrome Web Store
npm run package
```
