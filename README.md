# Gesture X

**Gesture X** is a modern, privacy-first Chrome Extension that enables hands-free browser control through hand gestures and voice commands. Powered by MediaPipe and the Web Speech API.

## Features

- **Hands-Free Navigation**: Use gestures to scroll, switch tabs, navigate back/forward, and more.
- **Voice Commands**: Say phrases like "scroll down" or "new tab" to control the browser.
- **Privacy First**: All video and audio processing happens entirely locally on your device. No data is sent to external servers.
- **Customizable**: Remap gestures and voice commands to suit your workflow.

## Architecture

Gesture X is built specifically for Manifest V3. It leverages the `chrome.offscreen` API to keep camera and microphone processing alive without blocking your active tabs.

## Development

### Setup
```bash
npm install
npm run setup
```

### Testing
```bash
npm run test
npm run test:e2e
```

### Packaging
```bash
npm run package
```
This will produce a `gesture-x.zip` file in the `dist/` directory ready for Chrome Web Store upload.
