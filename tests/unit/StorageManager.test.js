import { jest } from '@jest/globals';
import {
  getSettings,
  saveSettings,
  updateSetting,
  resetSettings,
  getSession,
  saveSession,
  updateSession,
  clearSession,
  initializeStorage
} from '../../src/shared/StorageManager.js';
import { StorageKey, DEFAULT_SETTINGS, DEFAULT_SESSION } from '../../src/shared/constants.js';

describe('StorageManager', () => {
  let mockLocalGet;
  let mockLocalSet;
  let mockSessionGet;
  let mockSessionSet;
  let mockSessionRemove;

  beforeEach(() => {
    mockLocalGet = jest.fn();
    mockLocalSet = jest.fn();
    mockSessionGet = jest.fn();
    mockSessionSet = jest.fn();
    mockSessionRemove = jest.fn();

    global.chrome = {
      storage: {
        local: {
          get: mockLocalGet,
          set: mockLocalSet
        },
        session: {
          get: mockSessionGet,
          set: mockSessionSet,
          remove: mockSessionRemove
        }
      }
    };
  });

  afterEach(() => {
    delete global.chrome;
    jest.clearAllMocks();
  });

  describe('Settings (local storage)', () => {
    test('getSettings returns defaults when storage is empty', async () => {
      mockLocalGet.mockResolvedValue({});
      const settings = await getSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(mockLocalGet).toHaveBeenCalledWith(StorageKey.SETTINGS);
    });

    test('getSettings merges stored settings with defaults', async () => {
      mockLocalGet.mockResolvedValue({
        [StorageKey.SETTINGS]: {
          theme: 'dark' // Partial setting
        }
      });
      const settings = await getSettings();
      expect(settings.theme).toBe('dark');
      // Should inherit defaults for other properties
      expect(settings.sensitivity).toBe(DEFAULT_SETTINGS.sensitivity);
    });

    test('saveSettings sets the correct key', async () => {
      mockLocalSet.mockResolvedValue();
      const newSettings = { ...DEFAULT_SETTINGS, theme: 'dark' };
      await saveSettings(newSettings);
      expect(mockLocalSet).toHaveBeenCalledWith({ [StorageKey.SETTINGS]: newSettings });
    });

    test('updateSetting updates a single key without modifying others', async () => {
      mockLocalGet.mockResolvedValue({
        [StorageKey.SETTINGS]: { ...DEFAULT_SETTINGS }
      });
      mockLocalSet.mockResolvedValue();

      await updateSetting('theme', 'dark');

      const expectedSettings = { ...DEFAULT_SETTINGS, theme: 'dark' };
      expect(mockLocalSet).toHaveBeenCalledWith({ [StorageKey.SETTINGS]: expectedSettings });
    });

    test('resetSettings saves default settings', async () => {
      mockLocalSet.mockResolvedValue();
      await resetSettings();
      expect(mockLocalSet).toHaveBeenCalledWith({ [StorageKey.SETTINGS]: DEFAULT_SETTINGS });
    });
  });

  describe('Session (session storage)', () => {
    test('getSession returns defaults when storage is empty', async () => {
      mockSessionGet.mockResolvedValue({});
      const session = await getSession();
      expect(session).toEqual(DEFAULT_SESSION);
      expect(mockSessionGet).toHaveBeenCalledWith(StorageKey.SESSION);
    });

    test('saveSession sets the correct key', async () => {
      mockSessionSet.mockResolvedValue();
      const newSession = { ...DEFAULT_SESSION, isActive: true };
      await saveSession(newSession);
      expect(mockSessionSet).toHaveBeenCalledWith({ [StorageKey.SESSION]: newSession });
    });

    test('updateSession updates a single key', async () => {
      mockSessionGet.mockResolvedValue({
        [StorageKey.SESSION]: { ...DEFAULT_SESSION }
      });
      mockSessionSet.mockResolvedValue();

      await updateSession('isActive', true);
      const expectedSession = { ...DEFAULT_SESSION, isActive: true };
      expect(mockSessionSet).toHaveBeenCalledWith({ [StorageKey.SESSION]: expectedSession });
    });

    test('clearSession removes the session key', async () => {
      mockSessionRemove.mockResolvedValue();
      await clearSession();
      expect(mockSessionRemove).toHaveBeenCalledWith(StorageKey.SESSION);
    });
  });

  describe('Initialization', () => {
    test('initializeStorage saves defaults if first install', async () => {
      mockLocalGet.mockResolvedValue({}); // Empty
      mockLocalSet.mockResolvedValue();
      mockSessionSet.mockResolvedValue();

      await initializeStorage();

      expect(mockLocalSet).toHaveBeenCalledWith({ [StorageKey.SETTINGS]: DEFAULT_SETTINGS });
      expect(mockSessionSet).toHaveBeenCalledWith({ [StorageKey.SESSION]: DEFAULT_SESSION });
    });
  });
});
