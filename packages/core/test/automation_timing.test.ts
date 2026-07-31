import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HomeNetBridge } from '../src/service/bridge.service';
import { EventEmitter } from 'node:events';
import { Duplex } from 'stream';
import { eventBus } from '../src/service/event-bus.js';
import { CommandManager } from '../src/service/command.manager.js';

// Mock dependencies
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

const mockRunAutomationThen = vi.fn().mockImplementation(async () => {
  // Simulate a delay to prove we didn't wait for it
  await new Promise((resolve) => setTimeout(resolve, 50));
});

vi.mock('../src/automation/automation-manager.js', () => ({
  AutomationManager: vi.fn().mockImplementation(() => ({
    runAutomationThen: mockRunAutomationThen,
    stop: vi.fn(),
    start: vi.fn(),
  })),
}));

vi.mock('../src/state/state-manager.js', () => {
  const mockInstance = {
    processIncomingData: vi.fn(),
    getLightState: vi.fn(),
    getClimateState: vi.fn(),
    getAllStates: vi.fn().mockReturnValue({}),
    getEntityState: vi.fn(),
  };
  const MockStateManager = vi.fn().mockImplementation(() => mockInstance) as any;
  MockStateManager.create = vi.fn().mockResolvedValue(mockInstance);
  return { StateManager: MockStateManager };
});

vi.mock('../src/config/index.js', () => ({
  loadConfig: () =>
    Promise.resolve({
      serial: {
        portId: 'main',
        path: '/dev/ttyTEST',
      },
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

describe('Automation Timing Verification', () => {
  let bridge: HomeNetBridge;
  let fakeSerialPort: MockSerialPort;

  beforeEach(async () => {
    vi.useRealTimers();
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
    bridge.stop();
  });

  it('should return immediately without waiting for automation actions', async () => {
    const automationConfig = {
      id: 'test-automation',
      trigger: [],
      then: [],
    } as any;

    const start = Date.now();
    const result = await bridge.runAutomationThen(automationConfig);
    const end = Date.now();
    const duration = end - start;

    expect(result.success).toBe(true);
    // Should be much faster than the 50ms delay in the mock
    expect(duration).toBeLessThan(20);

    // Validating that the background task was indeed called
    expect(mockRunAutomationThen).toHaveBeenCalled();
  });

  it('should defer raw-tx-packet event emission to the next tick', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');
    const mockConfig = {
      packet_defaults: {
        tx_retry_cnt: 0,
        tx_timeout: 10,
        tx_delay: 50,
      },
    } as any;

    const commandManager = new CommandManager(
      fakeSerialPort as unknown as Duplex,
      mockConfig,
      'main',
    );

    // Execute sendRaw without waiting for completion (since there is no ackMatch, it will resolve when sent)
    await commandManager.sendRaw([0x02, 0x01, 0x03]);

    // Right after sendRaw resolved, the event should NOT be emitted yet because it's wrapped in setImmediate
    const hasTxEmitDirectly = emitSpy.mock.calls.some((call) => call[0] === 'raw-tx-packet');
    expect(hasTxEmitDirectly).toBe(false);

    // Wait for the next tick (setImmediate)
    await new Promise((resolve) => setImmediate(resolve));

    // After next tick, the event must be emitted
    expect(emitSpy).toHaveBeenCalledWith(
      'raw-tx-packet',
      expect.objectContaining({
        portId: 'main',
        payload: '020103',
      }),
    );

    emitSpy.mockRestore();
  });
});
