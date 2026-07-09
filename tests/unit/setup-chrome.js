import { jest } from '@jest/globals';

global.chrome = {
  runtime: {
    onInstalled: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() },
    onMessage: {
      addListener: jest.fn((listener) => {
        global.mockMessageListener = listener;
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
