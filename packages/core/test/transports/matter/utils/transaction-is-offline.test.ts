import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transactionIsOffline } from '../../../../src/transports/matter/utils/transaction-is-offline.js';
import { hasLocalActor } from '@matter/main/protocol';
import type { ActionContext } from '@matter/main';

vi.mock('@matter/main/protocol', () => ({
  hasLocalActor: vi.fn(),
}));

describe('transactionIsOffline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true if context is undefined', () => {
    expect(transactionIsOffline(undefined)).toBe(true);
  });

  it('should return true if context is null', () => {
    expect(transactionIsOffline(null)).toBe(true);
  });

  it('should return true if hasLocalActor returns true', () => {
    vi.mocked(hasLocalActor).mockReturnValue(true);
    const mockContext = {} as ActionContext;
    expect(transactionIsOffline(mockContext)).toBe(true);
    expect(hasLocalActor).toHaveBeenCalledWith(mockContext);
  });

  it('should return false if context is provided and hasLocalActor returns false', () => {
    vi.mocked(hasLocalActor).mockReturnValue(false);
    const mockContext = {} as ActionContext;
    expect(transactionIsOffline(mockContext)).toBe(false);
    expect(hasLocalActor).toHaveBeenCalledWith(mockContext);
  });
});
