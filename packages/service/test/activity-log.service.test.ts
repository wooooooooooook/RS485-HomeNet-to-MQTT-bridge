import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    eventBus: {
      on: vi.fn(),
      emit: vi.fn(),
      off: vi.fn(),
    },
  };
});

vi.mock('@rs485-homenet/core', () => ({
  eventBus: mocks.eventBus,
}));

import { ActivityLogService } from '../src/activity-log.service.js';

describe('ActivityLogService', () => {
  let service: ActivityLogService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new ActivityLogService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should limit logs to 1000 entries', () => {
    const MAX_LOGS = 1000;

    // Add 1100 logs
    for (let i = 0; i < 1100; i++) {
      service.addLog(`code_${i}`, { index: i });
    }

    const logs = service.getRecentLogs();

    // Check that we have logs (sanity check)
    expect(logs.length).toBeGreaterThan(0);

    // This assertion should fail before the fix, as logs will be 1100
    expect(logs.length).toBeLessThanOrEqual(MAX_LOGS);

    // Verify that we kept the NEWEST logs
    if (logs.length === MAX_LOGS) {
      expect(logs[0].code).toBe('code_100');
      expect(logs[logs.length - 1].code).toBe('code_1099');
    }
  });
});
