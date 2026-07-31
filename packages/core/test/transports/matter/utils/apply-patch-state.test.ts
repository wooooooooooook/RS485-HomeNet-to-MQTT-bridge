import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyPatchState } from '../../../../src/transports/matter/utils/apply-patch-state.js';

describe('applyPatchState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should apply patch to state and return the actual patch', () => {
    const state = { a: 1, b: 2 };
    const patch = { a: 2, c: 3 } as any;

    const result = applyPatchState(state, patch);

    expect(state).toEqual({ a: 2, b: 2, c: 3 });
    expect(result).toEqual({ a: 2, c: 3 });
  });

  it('should not mutate state or return actual patch if values are deep equal', () => {
    const state = { a: 1, b: { nested: true } };
    const patch = { a: 1, b: { nested: true } };

    const result = applyPatchState(state, patch);

    expect(state).toEqual({ a: 1, b: { nested: true } });
    expect(result).toEqual({});
  });

  it('should drop out-of-order sequences', () => {
    const state = { a: 1 };

    applyPatchState(state, { a: 2 }, false, 10);
    expect(state).toEqual({ a: 2 });

    const result = applyPatchState(state, { a: 3 }, false, 5);

    expect(state).toEqual({ a: 2 });
    expect(result).toEqual({});
  });

  it('should schedule retry on synchronous transaction conflict', () => {
    const state = {
      _a: 1,
      get a() {
        return this._a;
      },
      set a(value) {
        if (value === 2) {
          throw new Error('synchronous-transaction-conflict');
        }
        this._a = value;
      },
    };

    const patch = { a: 2 };

    const result = applyPatchState(state, patch, false, 1);

    // Initial application should fail but return the patch that was meant to be applied
    expect(result).toEqual({ a: 2 });
    expect(state._a).toBe(1); // not updated

    // It should have scheduled a retry
    expect(vi.getTimerCount()).toBe(1);

    // Advance time, but keep it throwing error to simulate max retries
    let callCount = 0;
    const originalSet = Object.getOwnPropertyDescriptor(state, 'a')!.set!;
    Object.defineProperty(state, 'a', {
      get() {
        return this._a;
      },
      set(value) {
        callCount++;
        originalSet.call(this, value);
      },
    });

    vi.advanceTimersByTime(20 * 25); // Advance past max retries (20 * 20ms = 400ms)

    // Check it retired 20 times (MAX_RETRY_COUNT)
    expect(callCount).toBe(20);
    expect(state._a).toBe(1); // Still 1 because we never let it succeed
  });

  it('should succeed on retry if conflict resolves', () => {
    let failSet = true;
    const state = {
      _a: 1,
      get a() {
        return this._a;
      },
      set a(value) {
        if (failSet) {
          throw new Error('synchronous-transaction-conflict');
        }
        this._a = value;
      },
    };

    applyPatchState(state, { a: 2 }, false, 1);

    expect(state._a).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    // Allow it to succeed on the next try
    failSet = false;
    vi.advanceTimersByTime(20);

    expect(state._a).toBe(2);
  });

  it('should drop patch if context expired when reading', () => {
    const state = {
      get a() {
        const error = new Error('Context expired-reference');
        error.name = 'ExpiredReferenceError';
        throw error;
      },
    };

    const result = applyPatchState(state, { a: 2 } as any);

    expect(result).toEqual({});
  });

  it('should drop patch if context expired when writing', () => {
    const state = {
      _a: 1,
      get a() {
        return this._a;
      },
      set a(value) {
        const error = new Error('Context expired-reference');
        error.name = 'ExpiredReferenceError';
        throw error;
      },
    };

    const result = applyPatchState(state, { a: 2 });

    // It returns actual patch (what it tried to apply)
    expect(result).toEqual({ a: 2 });
    expect(state._a).toBe(1);
  });

  it('should continue applying to other properties if one fails normally', () => {
    const state = {
      _a: 1,
      get a() {
        return this._a;
      },
      set a(value) {
        throw new Error('Some random error');
      },
      b: 1,
    };

    const result = applyPatchState(state, { a: 2, b: 2 });

    expect(result).toEqual({ a: 2, b: 2 });
    expect(state.b).toBe(2);
    expect(state._a).toBe(1);
  });

  it('should suppress endpoint storage error', () => {
    const state = {
      _a: 1,
      get a() {
        return this._a;
      },
      set a(value) {
        throw new Error(
          'Endpoint storage inaccessible because endpoint is not a node and is not owned by another endpoint',
        );
      },
    };

    const result = applyPatchState(state, { a: 2 });

    expect(result).toEqual({ a: 2 });
    expect(state._a).toBe(1);
  });
});
