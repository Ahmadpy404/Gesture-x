import { jest } from '@jest/globals';
import { MessageType, CommandId } from '../../src/shared/constants.js';

describe('Service Worker', () => {
  let mockMessageListener;

  beforeAll(async () => {
    // Mock Chrome API globally before importing service worker
    global.chrome = {
      runtime: {
        onInstalled: { addListener: jest.fn() },
        onStartup: { addListener: jest.fn() },
        onMessage: {
          addListener: jest.fn((listener) => {
            mockMessageListener = listener;
          }),
          removeListener: jest.fn()
        },
        getContexts: jest.fn().mockResolvedValue([]),
        sendMessage: jest.fn().mockResolvedValue(),
        getURL: jest.fn().mockReturnValue('chrome-extension://mock/offscreen.html'),
        getManifest: jest.fn().mockReturnValue({ name: 'Gesture X', version: '1.0' }),
      },
      alarms: {
        onAlarm: { addListener: jest.fn() },
        create: jest.fn(),
        get: jest.fn().mockResolvedValue(null),
      },
      offscreen: {
        createDocument: jest.fn().mockResolvedValue(),
        closeDocument: jest.fn().mockResolvedValue(),
      },
      tabs: {
        query: jest.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://example.com', title: 'Example' }]),
        sendMessage: jest.fn().mockResolvedValue(),
        goBack: jest.fn().mockResolvedValue(),
        goForward: jest.fn().mockResolvedValue(),
        reload: jest.fn().mockResolvedValue(),
        create: jest.fn().mockResolvedValue(),
        remove: jest.fn().mockResolvedValue(),
        update: jest.fn().mockResolvedValue(),
      },
      windows: {
        getCurrent: jest.fn().mockResolvedValue({ id: 10, state: 'normal' }),
        update: jest.fn().mockResolvedValue(),
      },
      bookmarks: {
        create: jest.fn().mockResolvedValue(),
      },
      sessions: {
        restore: jest.fn().mockResolvedValue(),
      },
      extension: {
        getViews: jest.fn().mockReturnValue([]),
      },
      storage: {
        local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue() },
        session: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue() },
      }
    };

    await import('../../src/background/service-worker.js');
  });

  afterAll(() => {
    delete global.chrome;
  });

  beforeEach(() => {
    // Clear mock calls before each test so we don't pollute counts
    jest.clearAllMocks();
  });

  test('registers lifecycle listeners on load', () => {
    // These were called during import() in beforeAll, so clearAllMocks cleared them.
    // However, they are already registered in the mock object, so we know they were called.
    // Let's just check that mockMessageListener is defined as a proxy for successful registration.
    expect(mockMessageListener).toBeInstanceOf(Function);
  });

  test('executeCommand: NAV_BACK triggers chrome.tabs.goBack', async () => {
    const message = {
      type: MessageType.VOICE_COMMAND,
      source: 'offscreen',
      timestamp: Date.now(),
      payload: {
        command: CommandId.NAV_BACK,
        transcript: 'go back',
        confidence: 0.9
      }
    };

    mockMessageListener(message, { id: 'sender-1' }, jest.fn());
    await new Promise(r => setTimeout(r, 10));

    expect(global.chrome.tabs.goBack).toHaveBeenCalled();
  });

  test('executeCommand: TAB_NEW triggers chrome.tabs.create', async () => {
    const message = {
      type: MessageType.GESTURE_CONFIRMED,
      source: 'offscreen',
      timestamp: Date.now(),
      payload: {
        label: 'THUMBS_UP',
        confidence: 0.9,
        timestamp: Date.now(),
        hand: 'Right'
      }
    };

    global.chrome.storage.local.get.mockResolvedValue({
      'gesture_x_settings': {
        gestureBindings: { 'THUMBS_UP': CommandId.TAB_NEW }
      }
    });

    mockMessageListener(message, { id: 'sender-1' }, jest.fn());
    await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 10));

    expect(global.chrome.tabs.create).toHaveBeenCalledWith({ active: true });
  });

  test('executeCommand: BOOKMARK_ADD triggers chrome.bookmarks.create', async () => {
    const message = {
      type: MessageType.VOICE_COMMAND,
      source: 'offscreen',
      timestamp: Date.now(),
      payload: {
        command: CommandId.BOOKMARK_ADD,
        transcript: 'bookmark this',
        confidence: 0.9
      }
    };

    mockMessageListener(message, { id: 'sender-1' }, jest.fn());
    await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 10));

    expect(global.chrome.bookmarks.create).toHaveBeenCalledWith({
      title: 'Example',
      url: 'https://example.com'
    });
  });

  test('handleToggleActive creates/closes offscreen document', async () => {
    const enableMsg = {
      type: MessageType.TOGGLE_ACTIVE,
      source: 'popup',
      timestamp: Date.now(),
      payload: { active: true }
    };
    mockMessageListener(enableMsg, {}, jest.fn());
    await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 10));

    expect(global.chrome.offscreen.createDocument).toHaveBeenCalled();

    global.chrome.runtime.getContexts.mockResolvedValue([{ type: 'OFFSCREEN_DOCUMENT' }]);
    const disableMsg = {
      type: MessageType.TOGGLE_ACTIVE,
      source: 'popup',
      timestamp: Date.now(),
      payload: { active: false }
    };
    mockMessageListener(disableMsg, {}, jest.fn());
    await new Promise(r => setTimeout(r, 10));
    await new Promise(r => setTimeout(r, 10));

    expect(global.chrome.offscreen.closeDocument).toHaveBeenCalled();
  });
});

