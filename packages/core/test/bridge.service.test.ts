import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Duplex } from 'stream';
import { HomeNetBridge } from '../src/service/bridge.service';
import { eventBus } from '../src/service/event-bus.js';

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
      serial: {
        portId: 'main',
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
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

class MockSerialPort extends EventEmitter {
  write = vi.fn();
  open(callback: (err?: Error | null) => void) {
    callback?.(null);
  }
  destroy = vi.fn();
}

describe('HomeNetBridge Packet Interval Analysis', () => {
  let bridge: HomeNetBridge;
  let fakeSerialPort: MockSerialPort;
  const eventBusEmitSpy = vi.spyOn(eventBus, 'emit');

  beforeEach(async () => {
    vi.useFakeTimers();

    fakeSerialPort = new MockSerialPort();
    const mockSerialFactory = vi.fn().mockResolvedValue(fakeSerialPort as unknown as Duplex);

    bridge = new HomeNetBridge({
      configPath: 'test.yaml',
      mqttUrl: 'mqtt://fake',
      serialFactory: mockSerialFactory,
    });

    await bridge.start();
  });

  afterEach(() => {
    eventBusEmitSpy.mockClear();
    vi.useRealTimers();
    bridge.stop();
  });

  it('should calculate interval between packets and emit raw-data-with-interval event', () => {
    const data = Buffer.from([0x01, 0x02, 0x03]);
    bridge.startRawPacketListener();

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

  it('should increase sample size beyond 10 and rotate at 1000', () => {
    bridge.startRawPacketListener();
    // Simulate 1010 packets
    for (let i = 0; i < 1010; i++) {
      vi.advanceTimersByTime(1);
      fakeSerialPort.emit('data', Buffer.from([i % 255]));
    }

    const calls = eventBusEmitSpy.mock.calls.filter((call) => call[0] === 'packet-interval-stats');
    const lastCall = calls[calls.length - 1];
    const stats = lastCall[1] as any;

    // Should be capped at 1000
    expect(stats.sampleSize).toBe(1000);
  });

  it('should calculate idle statistics correctly', () => {
    bridge.startRawPacketListener();

    fakeSerialPort.emit('data', Buffer.from([0]));

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(10);
      fakeSerialPort.emit('data', Buffer.from([i + 1]));
    }

    vi.advanceTimersByTime(200);
    fakeSerialPort.emit('data', Buffer.from([4]));

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(10);
      fakeSerialPort.emit('data', Buffer.from([i + 5]));
    }

    vi.advanceTimersByTime(200);
    fakeSerialPort.emit('data', Buffer.from([8]));

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(10);
      fakeSerialPort.emit('data', Buffer.from([i + 9]));
    }

    const calls = eventBusEmitSpy.mock.calls.filter((call) => call[0] === 'packet-interval-stats');
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    const stats = lastCall[1] as any;

    // Check if idle stats are calculated
    expect(stats.packetAvg).toBeDefined();
    expect(stats.idleAvg).toBeDefined();
    expect(stats.packetStdDev).toBeDefined();
    expect(stats.idleStdDev).toBeDefined();
    expect(stats.idleOccurrenceStdDev).toBeDefined();
    expect(stats.idleOccurrenceAvg).toBeDefined();

    // We expect some differentiation between packetAvg (small) and idleAvg (large)
    if (stats.packetAvg > 0 && stats.idleAvg > 0) {
      expect(stats.packetAvg).toBeLessThan(stats.idleAvg);
    }
  });

  it('should NOT emit stats when enableStats is false', () => {
    bridge.startRawPacketListener(undefined, { enableStats: false });

    // Simulate packets
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(10);
      fakeSerialPort.emit('data', Buffer.from([i]));
    }

    const statsCalls = eventBusEmitSpy.mock.calls.filter(
      (call) => call[0] === 'packet-interval-stats',
    );
    expect(statsCalls.length).toBe(0);

    const rawCalls = eventBusEmitSpy.mock.calls.filter(
      (call) => call[0] === 'raw-data-with-interval',
    );
    expect(rawCalls.length).toBeGreaterThan(0);
  });

  it('should emit stats when stats are enabled after being disabled', () => {
    // First, start without stats
    bridge.startRawPacketListener(undefined, { enableStats: false });

    // Simulate packets
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(10);
      fakeSerialPort.emit('data', Buffer.from([i]));
    }

    let statsCalls = eventBusEmitSpy.mock.calls.filter(
      (call) => call[0] === 'packet-interval-stats',
    );
    expect(statsCalls.length).toBe(0);

    // Now enable stats (simulate UI connecting)
    bridge.startRawPacketListener(undefined, { enableStats: true });

    // Simulate more packets
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(10);
      fakeSerialPort.emit('data', Buffer.from([i]));
    }

    statsCalls = eventBusEmitSpy.mock.calls.filter((call) => call[0] === 'packet-interval-stats');
    expect(statsCalls.length).toBeGreaterThan(0);
  });
});
