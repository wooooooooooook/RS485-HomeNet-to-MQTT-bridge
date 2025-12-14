import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Duplex } from 'stream';
import { HomeNetBridge } from '../src/service/bridge.service';
import { eventBus } from '../src/service/event-bus.js';

// Mocks

// We no longer need to mock serialport globally or use the hack.
// vi.mock('serialport', ...);

vi.mock('mqtt', () => ({
  default: {
    connect: () => ({
      publish: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn(),
      end: vi.fn(),
      connected: true,
    }),
  },
}));

vi.mock('../src/state/state-manager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    processIncomingData: vi.fn(),
    getLightState: vi.fn(),
    getClimateState: vi.fn(),
  })),
}));

vi.mock('../src/config/index.js', () => ({
  loadConfig: () =>
    Promise.resolve({
      serial: { portId: 'main', path: '/dev/ttyUSB0', baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1 },
      serials: [
        {
          portId: 'main',
          path: '/dev/ttyUSB0',
          baud_rate: 9600,
          data_bits: 8,
          parity: 'none',
          stop_bits: 1,
        },
      ],
    }),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
}));

// Create a mock class that behaves like Duplex for our purposes
class MockSerialPort extends EventEmitter {
  write = vi.fn();
  open(callback: (err?: Error | null) => void) {
    callback?.(null);
  }
  destroy = vi.fn();
  // Mimic minimal Duplex props if needed by HomeNetBridge (it only uses write, on, destroy)
}

describe('HomeNetBridge Packet Interval Analysis', () => {
  let bridge: HomeNetBridge;
  let fakeSerialPort: MockSerialPort;
  const eventBusEmitSpy = vi.spyOn(eventBus, 'emit');

  beforeEach(async () => {
    vi.useFakeTimers();

    // Create the mock serial port instance we will control
    fakeSerialPort = new MockSerialPort();

    // Define the factory to return our mock
    const mockSerialFactory = vi.fn().mockResolvedValue(fakeSerialPort as unknown as Duplex);

    bridge = new HomeNetBridge({
      configPath: 'test.yaml',
      mqttUrl: 'mqtt://fake',
      serialFactory: mockSerialFactory,
    });

    await bridge.start();

    // No longer need: fakeSerialPort = mockSerialPortInstances[mockSerialPortInstances.length - 1];
  });

  afterEach(() => {
    eventBusEmitSpy.mockClear();
    vi.useRealTimers();
    bridge.stop();
  });

  it('should calculate interval between packets and emit raw-data-with-interval event', () => {
    const data = Buffer.from([0x01, 0x02, 0x03]);
    bridge.startRawPacketListener();

    // First packet
    fakeSerialPort.emit('data', data);
    expect(eventBusEmitSpy).toHaveBeenCalledWith(
      'raw-data-with-interval',
      expect.objectContaining({
        payload: '010203',
        interval: null,
        portId: 'main',
        receivedAt: expect.any(String),
      }),
    );

    // Second packet after 50ms
    vi.advanceTimersByTime(50);
    fakeSerialPort.emit('data', data);
    expect(eventBusEmitSpy).toHaveBeenCalledWith(
      'raw-data-with-interval',
      expect.objectContaining({
        payload: '010203',
        interval: expect.any(Number),
        portId: 'main',
        receivedAt: expect.any(String),
      }),
    );
  });

  it('should not emit stats if fewer than 10 packets have been received', () => {
    bridge.startRawPacketListener();
    for (let i = 0; i < 10; i++) {
      fakeSerialPort.emit('data', Buffer.from([i]));
      vi.advanceTimersByTime(10);
    }
    expect(eventBusEmitSpy).not.toHaveBeenCalledWith('packet-interval-stats', expect.any(Object));
  });

  it('should calculate and emit packet interval stats after 11 packets', () => {
    bridge.startRawPacketListener();
    // 10 intervals: 9 short, 1 long
    fakeSerialPort.emit('data', Buffer.from([0])); // first packet

    for (let i = 0; i < 9; i++) {
      vi.advanceTimersByTime(10); // 10ms interval
      fakeSerialPort.emit('data', Buffer.from([i + 1]));
    }

    // 11th packet after a long interval
    vi.advanceTimersByTime(200);
    fakeSerialPort.emit('data', Buffer.from([10]));

    expect(eventBusEmitSpy).toHaveBeenCalledWith(
      'packet-interval-stats',
      expect.objectContaining({
        portId: 'main',
        packetAvg: expect.any(Number),
        packetStdDev: expect.any(Number),
        idleAvg: expect.any(Number),
        idleStdDev: expect.any(Number),
      }),
    );
  });

  it('should calculate idle occurrence average correctly', () => {
    bridge.startRawPacketListener();
    const intervals = [10, 10, 10, 200, 10, 10, 10, 200, 10, 10];

    // First packet
    fakeSerialPort.emit('data', Buffer.from([0]));

    intervals.forEach((interval, index) => {
      vi.advanceTimersByTime(interval);
      fakeSerialPort.emit('data', Buffer.from([index + 1]));
    });

    expect(eventBusEmitSpy).toHaveBeenCalledWith(
      'packet-interval-stats',
      expect.objectContaining({
        portId: 'main',
        packetAvg: expect.any(Number),
        idleAvg: expect.any(Number),
        idleOccurrenceAvg: expect.any(Number),
      }),
    );
  });
});
