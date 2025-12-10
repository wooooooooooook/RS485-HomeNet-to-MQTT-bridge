import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { HomeNetBridge } from '../src/service/bridge.service';
import { eventBus } from '../src/service/event-bus.js';

// Mocks
const mockSerialPortInstances: any[] = [];
vi.mock('serialport', () => {
  const SerialPortMock = class extends EventEmitter {
    constructor() {
      super();
      mockSerialPortInstances.push(this);
    }
    write = vi.fn();
    open(callback: (err?: Error | null) => void) {
      callback?.(null);
    }
    destroy = vi.fn();
  };
  return { SerialPort: SerialPortMock };
});

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
  })),
}));

vi.mock('../src/config/index.js', () => ({
  loadConfig: () =>
    Promise.resolve({
      serial: { baud_rate: 9600 },
    }),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
}));

describe('HomeNetBridge Packet Interval Analysis', () => {
  let bridge: HomeNetBridge;
  let fakeSerialPort: EventEmitter;
  const eventBusEmitSpy = vi.spyOn(eventBus, 'emit');

  beforeEach(async () => {
    vi.useFakeTimers();
    bridge = new HomeNetBridge({
      configPath: 'test.yaml',
      mqttUrl: 'mqtt://fake',
    });
    await bridge.start();

    // The serial port instance is created inside start()
    // We need a way to get a reference to it.
    // This is a bit of a hack, but we'll assume the mock is instantiated.
    // A better approach would be dependency injection.
    fakeSerialPort = mockSerialPortInstances[mockSerialPortInstances.length - 1];
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
    expect(eventBusEmitSpy).toHaveBeenCalledWith('raw-data-with-interval', {
      payload: '010203',
      interval: null,
      receivedAt: expect.any(String),
    });

    // Second packet after 50ms
    vi.advanceTimersByTime(50);
    fakeSerialPort.emit('data', data);
    expect(eventBusEmitSpy).toHaveBeenCalledWith('raw-data-with-interval', {
      payload: '010203',
      interval: expect.any(Number),
      receivedAt: expect.any(String),
    });
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
        packetAvg: expect.any(Number),
        packetStdDev: expect.any(Number),
        idleAvg: expect.any(Number),
        idleStdDev: expect.any(Number),
        sampleSize: 10,
        idleOccurrenceAvg: expect.any(Number),
        idleOccurrenceStdDev: expect.any(Number),
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
        packetAvg: expect.any(Number),
        idleAvg: expect.any(Number),
        idleOccurrenceAvg: expect.any(Number),
        idleOccurrenceStdDev: expect.any(Number),
      }),
    );
  });
});
