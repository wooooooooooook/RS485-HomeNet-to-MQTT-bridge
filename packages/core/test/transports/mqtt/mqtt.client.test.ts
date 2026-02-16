import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MqttClient } from '../../../src/transports/mqtt/mqtt.client';
import mqtt from 'mqtt';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock mqtt
vi.mock('mqtt', () => {
  return {
    default: {
      connect: vi.fn(),
    },
  };
});

describe('MqttClient', () => {
  let mqttClient: MqttClient;
  let mockClient: any;
  let mockScanClient: any;

  beforeEach(() => {
    vi.useFakeTimers();

    // Setup default mock client
    mockClient = {
      on: vi.fn(),
      off: vi.fn(),
      end: vi.fn(),
      connected: false,
      publish: vi.fn(),
      options: { host: 'localhost' },
    };

    // Setup scan client mock
    mockScanClient = {
      on: vi.fn(),
      off: vi.fn(),
      end: vi.fn(),
      subscribe: vi.fn(),
      connected: false,
      options: { host: 'localhost' },
    };

    // Reset mocks
    vi.mocked(mqtt.connect).mockReset();

    // Configure mqtt.connect to return mockClient first, then mockScanClient
    vi.mocked(mqtt.connect)
      .mockReturnValueOnce(mockClient)
      .mockReturnValueOnce(mockScanClient);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize MQTT client with correct options', () => {
      // We need to re-mock connect here because beforeEach sets it up,
      // but new MqttClient() consumes the first mockReturnValueOnce.
      // Actually beforeEach is fine, it sets up for the test.

      mqttClient = new MqttClient('mqtt://localhost:1883', { clientId: 'test-client' });

      expect(mqtt.connect).toHaveBeenCalledWith('mqtt://localhost:1883', expect.objectContaining({
        clientId: 'test-client',
        connectTimeout: 10000,
      }));
    });

    it('should resolve connectionPromise on connect', async () => {
      // Setup mock on implementation to trigger callback immediately or store it
      let connectCallback: () => void;
      mockClient.on.mockImplementation((event: string, cb: any) => {
        if (event === 'connect') {
          connectCallback = cb;
        }
      });

      mqttClient = new MqttClient('mqtt://localhost:1883');

      const promise = mqttClient.connectionPromise;

      // Simulate connect event
      if (connectCallback!) connectCallback();

      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('clearRetainedMessages', () => {
    beforeEach(() => {
      // Re-initialize for each test to ensure fresh state
      // We need to setup the mockClient to be "connected" for these tests
      mockClient.connected = true;

      // Setup mockClient.on to capture connect handler so we can simulate connection
      mockClient.on.mockImplementation((event: string, cb: any) => {
        if (event === 'connect') cb();
      });

      mqttClient = new MqttClient('mqtt://localhost:1883');

      // Consume the first connect call (from constructor)
      // The second connect call will be for scanClient when clearRetainedMessages is called
    });

    it('should throw if client is not connected', async () => {
      mockClient.connected = false;
      await expect(mqttClient.clearRetainedMessages('test/topic')).rejects.toThrow('MQTT client is not connected');
    });

    it('should create a scan client and subscribe', async () => {
      // Setup scan client connect handler
      mockScanClient.on.mockImplementation((event: string, cb: any) => {
        if (event === 'connect') cb();
      });

      const promise = mqttClient.clearRetainedMessages('test/topic');

      // Advance timers to trigger the timeout inside the promise
      vi.advanceTimersByTime(2000);

      await promise;

      expect(mqtt.connect).toHaveBeenCalledTimes(2); // 1 for main, 1 for scan
      expect(mockScanClient.subscribe).toHaveBeenCalledWith('test/topic/#');
    });

    it('should clear retained messages found', async () => {
      let messageHandler: (topic: string, message: Buffer, packet: any) => void;

      mockScanClient.on.mockImplementation((event: string, cb: any) => {
        if (event === 'connect') {
            cb();
        } else if (event === 'message') {
            messageHandler = cb;
        }
      });

      // Mock publish implementation to succeed
      mockClient.publish.mockImplementation((topic: string, payload: Buffer, options: any, cb: any) => {
        cb(null);
      });

      const promise = mqttClient.clearRetainedMessages('test/topic');

      // Allow microtasks to run so message handler is registered
      await vi.runAllTicks(); // This might not be enough if promise resolution is pending

      // Manually trigger message handler if it was captured
      // Since scanClient.on('connect') runs synchronously in our mock,
      // scanClient.on('message') also runs synchronously.
      // So messageHandler should be set.

      if (messageHandler!) {
        messageHandler('test/topic/1', Buffer.from('data'), { retain: true, cmd: 'publish', qos: 0, dup: false, topic: 'test/topic/1', payload: Buffer.from('data') });
        messageHandler('test/topic/2', Buffer.from('data'), { retain: true, cmd: 'publish', qos: 0, dup: false, topic: 'test/topic/2', payload: Buffer.from('data') });
        // Should ignore non-retained
        messageHandler('test/topic/3', Buffer.from('data'), { retain: false, cmd: 'publish', qos: 0, dup: false, topic: 'test/topic/3', payload: Buffer.from('data') });
      }

      vi.advanceTimersByTime(2000);

      const count = await promise;

      expect(count).toBe(2);
      expect(mockClient.publish).toHaveBeenCalledWith('test/topic/1', expect.any(Buffer), { retain: true, qos: 1 }, expect.any(Function));
      expect(mockClient.publish).toHaveBeenCalledWith('test/topic/2', expect.any(Buffer), { retain: true, qos: 1 }, expect.any(Function));
      expect(mockClient.publish).not.toHaveBeenCalledWith('test/topic/3', expect.any(Buffer), expect.any(Object), expect.any(Function));
      expect(mockScanClient.end).toHaveBeenCalled();
    });

    it('should resolve with 0 if no retained messages found', async () => {
      mockScanClient.on.mockImplementation((event: string, cb: any) => {
        if (event === 'connect') cb();
      });

      const promise = mqttClient.clearRetainedMessages('test/topic');

      vi.advanceTimersByTime(2000);

      const count = await promise;

      expect(count).toBe(0);
      expect(mockClient.publish).not.toHaveBeenCalled();
      expect(mockScanClient.end).toHaveBeenCalled();
    });

    it('should reject if scan client errors', async () => {
      // Ensure error handler is triggered
      mockScanClient.on.mockImplementation((event: string, cb: any) => {
        if (event === 'error') {
            // Delay error slightly or call immediately?
            // The promise is created, then scanClient created.
            cb(new Error('Scan error'));
        }
      });

      const promise = mqttClient.clearRetainedMessages('test/topic');

      await expect(promise).rejects.toThrow('Scan error');
      expect(mockScanClient.end).toHaveBeenCalled();
    });
  });
});
