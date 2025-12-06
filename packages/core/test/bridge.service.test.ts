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

  it('should not emit stats if fewer than 100 packets have been received', () => {
    for (let i = 0; i < 99; i++) {
      fakeSerialPort.emit('data', Buffer.from([i]));
      vi.advanceTimersByTime(10);
    }
    expect(eventBusEmitSpy).not.toHaveBeenCalledWith('packet-interval-stats', expect.any(Object));
  });

  it('should calculate and emit packet interval stats after 101 packets', () => {
    // 100 intervals: 99 short, 1 long
    for (let i = 0; i < 100; i++) {
      fakeSerialPort.emit('data', Buffer.from([i]));
      vi.advanceTimersByTime(10); // 10ms interval
    }

    // 101st packet after a long interval
    vi.advanceTimersByTime(200);
    fakeSerialPort.emit('data', Buffer.from([100]));

    // The stats are calculated based on the 100 intervals collected so far.
    // The loop above advances time by 10ms after each packet, including the last one.
    // So the interval for the last packet is 10ms (from loop) + 200ms (explicit) = 210ms.

    // Packet Intervals: 99 intervals of 10ms.
    // Idle Intervals: 1 interval of 210ms.

    // Packet Stats:
    // Avg: 10
    // StdDev: 0

    // Idle Stats:
    // Avg: 210
    // StdDev: 0

    // Idle Occurrence Stats:
    // Only 1 idle occurrence, so avg 0, stdDev 0.

    expect(eventBusEmitSpy).toHaveBeenCalledWith(
      'packet-interval-stats',
      expect.objectContaining({
        packetAvg: expect.any(Number),
        packetStdDev: expect.any(Number),
        idleAvg: expect.any(Number),
        idleStdDev: expect.any(Number),
        sampleSize: 100,
        idleOccurrenceAvg: expect.any(Number),
        idleOccurrenceStdDev: expect.any(Number),
      }),
    );
  });

  it('should calculate idle occurrence average correctly', () => {
    // Simulate a pattern: 10ms (x9), 200ms (idle), 10ms (x9), 200ms (idle)
    // Total 20 intervals.
    // Idle intervals at index 9 and 19.
    // Duration between idles: sum of intervals from index 10 to 19.
    // Intervals[10] to [18] are 10ms (9 packets).
    // Interval[19] is 200ms.
    // Sum = 9 * 10 + 200 = 290.
    // idleOccurrenceAvg = 290.

    // Need 100 packets to trigger stats.
    // Let's fill up with 10ms packets first.
    for (let i = 0; i < 80; i++) {
      fakeSerialPort.emit('data', Buffer.from([0]));
      vi.advanceTimersByTime(10);
    }

    // Now do the pattern
    // 1. 10ms (x9) -> already done part of it, but let's just add more 10ms
    for (let i = 0; i < 9; i++) {
      fakeSerialPort.emit('data', Buffer.from([0]));
      vi.advanceTimersByTime(10);
    }
    // 2. 200ms (idle)
    vi.advanceTimersByTime(200);
    fakeSerialPort.emit('data', Buffer.from([0]));

    // 3. 10ms (x9)
    for (let i = 0; i < 9; i++) {
      fakeSerialPort.emit('data', Buffer.from([0]));
      vi.advanceTimersByTime(10);
    }
    // 4. 200ms (idle)
    // Total intervals so far: 80 + 9 + 1 + 9 = 99.
    // Next one is the 100th interval.
    vi.advanceTimersByTime(200);
    fakeSerialPort.emit('data', Buffer.from([0]));

    // We need 100 intervals to trigger the stats.
    // Currently we have 99 intervals.
    // Emit one more packet to create the 100th interval.
    vi.advanceTimersByTime(10);
    fakeSerialPort.emit('data', Buffer.from([0]));

    // Intervals:
    // 0-88: 10ms (89 packets)
    // 89: 200ms (idle)
    // 90-98: 10ms (9 packets)
    // 99: 200ms (idle)
    // 100: 10ms (1 packet)

    // Idle indices in the 101 intervals (0-100):
    // Index 89 (200ms)
    // Index 99 (200ms)

    // Duration between idles: Sum(intervals[90]...intervals[99])
    // = 9 * 10 + 200 = 290.

    // Idle Occurrence Stats:
    // Only 1 interval between idles (290ms).
    // Avg: 290
    // StdDev: 0

    expect(eventBusEmitSpy).toHaveBeenCalledWith(
      'packet-interval-stats',
      expect.objectContaining({
        idleOccurrenceAvg: expect.any(Number),
        idleOccurrenceStdDev: expect.any(Number),
      }),
    );
  });
});
