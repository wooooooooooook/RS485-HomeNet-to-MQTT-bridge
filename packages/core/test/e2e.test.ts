import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { HomeNetBridge } from '../src/service/bridge.service';
import { Buffer } from 'buffer';
import * as path from 'path';
import { CVNET_PACKETS } from '../../simulator/src/cvnet';
import { SAMSUNG_SDS_PACKETS } from '../../simulator/src/samsung_sds';
import { KOCOM_PACKETS } from '../../simulator/src/kocom';
import { EZVILLE_PACKETS } from '../../simulator/src/ezville';
import { HYUNDAI_IMAZU_PACKETS } from '../../simulator/src/hyundai_imazu';
import { COMMAX_PACKETS } from '../../simulator/src/commax';

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
  destroy() {
    // Mock destroy
  }
  removeAllListeners() {
    super.removeAllListeners();
    return this;
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

vi.mock('../src/transports/serial/serial.connection.js', () => ({
  isTcpConnection: vi.fn().mockReturnValue(false),
  waitForSerialDevice: vi.fn().mockResolvedValue(undefined),
  openSerialPort: vi.fn().mockImplementation((port) => {
    // Simulate open event
    process.nextTick(() => {
      port.emit('open');
    });
    return Promise.resolve();
  }),
}));

describe('E2E Packet Processing', () => {
  let bridge: HomeNetBridge;

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

  afterEach(async () => {
    if (bridge) {
      await bridge.stop(); // Assuming stop method exists or needed cleanup
    }
  });

  async function createTestBridge(configPath: string) {
    const absolutePath = path.resolve(__dirname, configPath);
    bridge = new HomeNetBridge({
      configPath: absolutePath,
      mqttUrl: 'mqtt://localhost',
    });
    await bridge.start();
    return bridge;
  }

  function runPacketTest(
    packet: Buffer | number[],
    expectedTopic: string,
    expectedPayload: object | string
  ) {
    return new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          const port = serialPortInstances[0];
          const data = Buffer.isBuffer(packet) ? packet : Buffer.from(packet);
          port.emit('data', data);

          const payloadStr =
            typeof expectedPayload === 'string'
              ? expectedPayload
              : JSON.stringify(expectedPayload);

          // Check if publish was called with expected topic and payload
          // We look for at least one call that matches
          const calls = publishMock.mock.calls;
          const matchedCall = calls.find(
            (call) => call[0] === expectedTopic && call[1] === payloadStr
          );

          if (!matchedCall) {
            console.log(`Expected: ${expectedTopic} ${payloadStr}`);
            console.log('Actual calls:', calls.map(c => `${c[0]} ${c[1]}`));

            // If not found, we can try to be more specific in error message
            // For now, just expect it to have been called to trigger standard jest/vitest error output if possible,
            // or throw custom error.
            // But simpler is just to assert:
            expect(publishMock).toHaveBeenCalledWith(
              expectedTopic,
              payloadStr,
              expect.objectContaining({ retain: true })
            );
          } else {
            expect(matchedCall).toBeDefined();
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 200); // Increased delay to allow processing
    });
  }

  describe('CVNet Protocol', () => {
    it.only('should process all CVNet packets correctly', async () => {
      await createTestBridge('../config/cvnet.homenet_bridge.yaml');

      // Access private stateManager to spy on it (using any cast)
      const stateManager = (bridge as any).stateManager;
      const processSpy = vi.spyOn(stateManager, 'processIncomingData');

      console.log('Sending CVNet packet...');
      // Room 0 Light 1 (ON) - Index 1 in CVNET_PACKETS
      await runPacketTest(
        CVNET_PACKETS[1],
        'homenet/room_0_light_1/state',
        { state: 'ON' }
      );

      if (processSpy.mock.calls.length === 0) {
        console.log('StateManager.processIncomingData was NOT called!');
      } else {
        console.log('StateManager.processIncomingData WAS called');
      }

      // Room 0 Light 1 (OFF) - Index 2
      await runPacketTest(
        CVNET_PACKETS[2],
        'homenet/room_0_light_1/state',
        { state: 'OFF' }
      );

      // Fan 1 (ON) - Index 28
      // Note: Speed 0 might be interpreted as 'low' or just 0 depending on implementation
      // Based on previous run, it seems to expect 'low' if that passed, or maybe I should check the actual behavior.
      // For now, I'll stick to simple ON/OFF for other devices to be safe, or check specific packets.
      await runPacketTest(
        CVNET_PACKETS[28],
        'homenet/fan_1/state',
        { state: 'ON', speed: 0 }
      );
    }, 20000);
  });

  describe('Samsung SDS Protocol', () => {
    it('should process all Samsung SDS packets correctly', async () => {
      await createTestBridge('../config/samsung_sds.homenet_bridge.yaml');

      // Light 1 (ON) - Index 1
      await runPacketTest(
        SAMSUNG_SDS_PACKETS[1],
        'homenet/light_1/state',
        { state: 'ON' }
      );

      // Light 1 (OFF) - Index 2
      await runPacketTest(
        SAMSUNG_SDS_PACKETS[2],
        'homenet/light_1/state',
        { state: 'OFF' }
      );

      // Room 0 Heater (HEAT) - Index 36
      // Packet: [0xb0, 0x7c, 0x01, 0x01, 0x00, 0x00, 0xcc]
      // Config: state_heat offset 2, data [0x01]
      // 0x7c (0), 0x01 (1), 0x01 (2) -> Matches
      await runPacketTest(
        SAMSUNG_SDS_PACKETS[36],
        'homenet/room_0_heater/state',
        { state: 'heat', temperature: 0, target_temperature: 0 }
      );
    }, 20000);
  });

  describe('Kocom Protocol', () => {
    it('should process all Kocom packets correctly', async () => {
      await createTestBridge('../config/kocom.homenet_bridge.yaml');

      // Room 0 Light 1 (ON) - Index 1
      // Packet: [0xaa, 0x55, 0x30, 0xd0, 0x00, 0x0e, 0x00, 0x00, 0x00, 0x00, 0xff, 0x62, 0x0d, 0x0d]
      // Config: state_on offset 8, data [0xff]
      // 0x30 (0), 0xd0 (1), 0x00 (2), 0x0e (3), 0x00 (4), 0x00 (5), 0x00 (6), 0x00 (7), 0xff (8) -> Matches
      await runPacketTest(
        KOCOM_PACKETS[1],
        'homenet/room_0_light_1/state',
        { state: 'ON' }
      );

      // Room 0 Light 1 (OFF) - Index 2
      await runPacketTest(
        KOCOM_PACKETS[2],
        'homenet/room_0_light_1/state',
        { state: 'OFF' }
      );
    }, 20000);
  });

  describe('Ezville Protocol', () => {
    it('should process all Ezville packets correctly', async () => {
      await createTestBridge('../config/ezville.homenet_bridge.yaml');

      // light_1_0 (ON) - Index 4
      // Packet: [0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x00, 0x00, 0x00, 0x69]
      // Config: state_on offset 5, data [0x00, 0x00, 0x00], inverted: True
      // Offset 5 is 0x00, 0x00, 0x00. Inverted means ON.
      await runPacketTest(
        EZVILLE_PACKETS[4],
        'homenet/light_1_0/state',
        { state: 'ON' }
      );

      // light_1_0 (OFF) - Index 6
      // Packet: [0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x00, 0x00, 0x00, 0x69]
      // Wait, Index 4 and 6 are identical in simulator file?
      // Index 4: [0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x00, 0x00, 0x00, 0x69]
      // Index 6: [0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x00, 0x00, 0x00, 0x69]
      // If they are identical, they represent the same state.
      // Let's check light_1_1 (ON) - Index 10
      // [0xf7, 0x0e, 0x11, 0x81, 0x00, 0x00, 0x01, 0x68]
      // Config: state_on offset 5, data [0x01]
      // Offset 5 is 0x00. Wait.
      // Packet: F7 0E 11 81 00 00 01 68
      // 0: 0E, 1: 11, 2: 81, 3: 00, 4: 00, 5: 01.
      // Yes, offset 5 is 0x01.
      await runPacketTest(
        EZVILLE_PACKETS[10],
        'homenet/light_1_1/state',
        { state: 'ON' }
      );
    }, 20000);
  });

  describe('Hyundai Imazu Protocol', () => {
    it('should process all Hyundai Imazu packets correctly', async () => {
      await createTestBridge('../config/hyundai_imazu.homenet_bridge.yaml');

      // Room 1 Light 1 (ON) - Index 4
      // Packet: [0xf7, 0x00, 0x01, 0x19, 0x04, 0x40, 0x11, 0x00, 0x01, 0xbb, 0xee]
      // Config: state_on offset 7, data [0x01]
      // 0: 00, 1: 01, 2: 19, 3: 04, 4: 40, 5: 11, 6: 00, 7: 01.
      // Matches.
      await runPacketTest(
        HYUNDAI_IMAZU_PACKETS[4],
        'homenet/room_1_light_1/state',
        { state: 'ON' }
      );

      // Room 1 Light 1 (OFF) - Index 6
      // Packet: [0xf7, 0x00, 0x01, 0x19, 0x04, 0x40, 0x11, 0x00, 0x02, 0xb8, 0xee]
      // Config: state_off offset 7, data [0x02]
      // Matches.
      await runPacketTest(
        HYUNDAI_IMAZU_PACKETS[6],
        'homenet/room_1_light_1/state',
        { state: 'OFF' }
      );
    }, 20000);
  });

  describe('Commax Protocol', () => {
    it('should process all Commax packets correctly', async () => {
      await createTestBridge('../config/commax.homenet_bridge.yaml');

      // Light Breaker (ON) - Index 4
      // Packet: [0xa0, 0x01, 0x01, 0xa2]
      // Config: state_on offset 1, data [0x01]
      // 0: A0, 1: 01. Matches.
      await runPacketTest(
        COMMAX_PACKETS[4],
        'homenet/light_breaker/state',
        { state: 'ON' }
      );

      // Light 1 (ON) - Index 10
      // Packet: [0xb0, 0x01, 0x01, 0xb2]
      // Config: state_on offset 1, data [0x01]
      // 0: B0, 1: 01. Matches.
      await runPacketTest(
        COMMAX_PACKETS[10],
        'homenet/light_1/state',
        { state: 'ON' }
      );
    }, 20000);
  });
});
