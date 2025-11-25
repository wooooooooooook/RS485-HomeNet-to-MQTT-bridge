
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
let connectionPromise: Promise<void>;
const mqttClientMock = {
  publish: publishMock,
  subscribe: subscribeMock,
  on: onMock,
  off: vi.fn(),
  end: endMock,
  connected: true,
  get connectionPromise() {
    return connectionPromise;
  },
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
    connectionPromise = Promise.resolve();
    onMock.mockImplementation((event, callback) => {
      if (event === 'connect') {
        process.nextTick(callback);
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
    createTestBridge('../config/cvnet.homenet_bridge.yaml');

    setTimeout(() => {
      const port = serialPortInstances[0];
      const packet = Buffer.from([0xF7, 0x20, 0x01, 0x21, 0x01, 0x00, 0x00, 0xAA]);
      port.emit('data', packet);

      expect(publishMock).toHaveBeenCalledWith(
        'homenet/room_0_light_1/state',
        JSON.stringify({ state: 'ON' }),
        { retain: true }
      );
      done();
    }, 100);
  });

  it('should publish Home Assistant discovery message for cvnet light', (done) => {
    createTestBridge('../config/cvnet.homenet_bridge.yaml');

    setTimeout(() => {
      expect(publishMock).toHaveBeenCalledWith(
        'homeassistant/light/room_0_light_1/config',
        expect.stringContaining('"name":"Room 0 Light 1"'),
        { retain: true }
      );
      done();
    }, 100);
  });
});
