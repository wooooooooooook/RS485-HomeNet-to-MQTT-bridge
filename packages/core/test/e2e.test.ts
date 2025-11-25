
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { HomeNetBridge } from '../src/service/bridge.service';
import { Buffer } from 'buffer';
import * as path from 'path';

// Mock SerialPort
class FakeSerialPort extends EventEmitter {
  constructor(options: any) {
    super();
    vi.fn(() => ({ options }));
  }
  write(data: any, callback: (err?: Error) => void) {
    callback();
  }
  close(callback: (err?: Error) => void) {
    callback();
  }
}
const serialPortInstances: FakeSerialPort[] = [];
vi.mock('serialport', () => ({
  SerialPort: vi.fn().mockImplementation((options: any) => {
    const instance = new FakeSerialPort(options);
    serialPortInstances.push(instance);
    return instance;
  }),
}));

// Mock MQTT
const publishMock = vi.fn();
const subscribeMock = vi.fn();
const onMock = vi.fn();
const endMock = vi.fn();
const mqttClientMock = {
  publish: publishMock,
  subscribe: subscribeMock,
  on: onMock,
  off: vi.fn(),
  end: endMock,
  connected: true,
};
vi.mock('mqtt', () => ({
  default: {
    connect: vi.fn(() => mqttClientMock),
  },
}));

describe('E2E Packet Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serialPortInstances.length = 0;
    onMock.mockImplementation((event, callback) => {
      if (event === 'connect') {
        callback();
      }
    });
  });

  async function createTestBridge(configPath: string) {
    const absolutePath = path.resolve(__dirname, configPath);
    const bridge = new HomeNetBridge({
      configPath: absolutePath,
      mqttUrl: 'mqtt://localhost',
    });
    await bridge.start();
    return bridge;
  }

  it('should publish correct MQTT message for cvnet light on packet', (done) => {
    createTestBridge('config/cvnet.test.yaml');

    // Allow the bridge to initialize
    setTimeout(() => {
      const port = serialPortInstances[0];
      const packet = Buffer.from([0xf7, 0x0c, 0x01, 0x04, 0x01, 0x01, 0x01, 0x11, 0x01, 0x01, 0x18, 0xfe]);
      port.emit('data', packet);

      expect(publishMock).toHaveBeenCalledWith(
        'homenet/test_light/state',
        JSON.stringify({ isOn: true }),
        { retain: true }
      );
      done();
    }, 100);
  });
});
