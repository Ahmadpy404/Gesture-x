import { jest } from '@jest/globals';
import { sendToRuntime, sendToRuntimeWithResponse, sendToTab, broadcastToAllTabs, onMessage } from '../../src/shared/MessageBus.js';
import { MessageType, ComponentId } from '../../src/shared/constants.js';

describe('MessageBus', () => {
  beforeEach(() => {
    global.chrome = {
      runtime: {
        sendMessage: jest.fn(),
        onMessage: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
        lastError: null,
      },
      tabs: {
        sendMessage: jest.fn(),
        query: jest.fn(),
      }
    };
  });

  afterEach(() => {
    delete global.chrome;
    jest.clearAllMocks();
  });

  describe('sendToRuntime', () => {
    test('sends message with correct envelope', async () => {
      chrome.runtime.sendMessage.mockResolvedValue();
      await sendToRuntime(MessageType.GET_STATUS, null, ComponentId.POPUP);
      
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.GET_STATUS,
          payload: null,
          source: ComponentId.POPUP,
          timestamp: expect.any(Number),
        })
      );
    });

    test('swallows expected connection errors gracefully', async () => {
      chrome.runtime.sendMessage.mockRejectedValue(new Error('Could not establish connection'));
      // Should not throw
      await expect(sendToRuntime(MessageType.GET_STATUS)).resolves.toBeUndefined();
    });
  });

  describe('sendToRuntimeWithResponse', () => {
    test('resolves when response is received', async () => {
      const mockResponse = { session: {} };
      chrome.runtime.sendMessage.mockImplementation((msg, callback) => {
        callback(mockResponse);
      });

      const response = await sendToRuntimeWithResponse(MessageType.GET_STATUS, null);
      expect(response).toEqual(mockResponse);
    });

    test('rejects on runtime error', async () => {
      chrome.runtime.lastError = { message: 'Some error' };
      chrome.runtime.sendMessage.mockImplementation((msg, callback) => {
        callback(null);
      });

      await expect(sendToRuntimeWithResponse(MessageType.GET_STATUS, null)).rejects.toThrow('Some error');
    });
  });

  describe('sendToTab', () => {
    test('sends message to specific tab', async () => {
      chrome.tabs.sendMessage.mockResolvedValue();
      await sendToTab(123, MessageType.SHOW_HUD, { text: 'test' });

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          type: MessageType.SHOW_HUD,
          source: ComponentId.SERVICE_WORKER,
        })
      );
    });
  });

  describe('broadcastToAllTabs', () => {
    test('sends message to all queried tabs', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      chrome.tabs.sendMessage.mockResolvedValue();

      await broadcastToAllTabs(MessageType.SHOW_HUD, { text: 'test' });
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.any(Object));
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, expect.any(Object));
    });
  });

  describe('onMessage', () => {
    test('registers listener and validates envelope', () => {
      const handler = jest.fn();
      const cleanup = onMessage(handler);

      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      // Invalid message
      const resultInvalid = listener({}, {}, jest.fn());
      expect(resultInvalid).toBe(false);
      expect(handler).not.toHaveBeenCalled();

      // Valid message
      const resultValid = listener({ type: MessageType.GET_STATUS }, {}, jest.fn());
      expect(handler).toHaveBeenCalled();
      
      cleanup();
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
    });
  });
});
