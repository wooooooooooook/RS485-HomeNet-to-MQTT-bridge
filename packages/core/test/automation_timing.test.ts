import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HomeNetBridge } from '../src/service/bridge.service';
import { EventEmitter } from 'node:events';
import { Duplex } from 'stream';

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

vi.mock('../src/state/state-manager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    processIncomingData: vi.fn(),
    getLightState: vi.fn(),
    getClimateState: vi.fn(),
    getAllStates: vi.fn().mockReturnValue({}),
    getEntityState: vi.fn(),
  })),
}));

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
});
