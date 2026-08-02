// packages/core/test/transports/matter/utils.test.ts

import { describe, it, expect } from 'vitest';
import { applyPatchState } from '../../../src/transports/matter/utils/apply-patch-state.js';
import { trimToLength } from '../../../src/transports/matter/utils/trim-to-length.js';
import { transactionIsOffline } from '../../../src/transports/matter/utils/transaction-is-offline.js';

describe('Matter Transports Utilities', () => {
  describe('applyPatchState', () => {
    it('should patch only different attributes and return the actual patch', () => {
      const state = {
        onOff: false,
        brightness: 100,
      };

      const actualPatch = applyPatchState(state, {
        onOff: true,
        brightness: 100, // unchanged
      });

      expect(actualPatch).toEqual({ onOff: true });
      expect(state.onOff).toBe(true);
      expect(state.brightness).toBe(100);
    });

    it('should return empty object if nothing changes', () => {
      const state = {
        onOff: true,
        brightness: 200,
      };

      const actualPatch = applyPatchState(state, {
        onOff: true,
        brightness: 200,
      });

      expect(actualPatch).toEqual({});
    });

    it('should retry asynchronously on transaction conflict and eventually succeed', async () => {
      let failCount = 2;
      const targetState = {
        _onOff: false,
        get onOff(): boolean {
          return this._onOff;
        },
        set onOff(value: boolean) {
          if (failCount > 0) {
            failCount--;
            throw new Error('synchronous-transaction-conflict');
          }
          this._onOff = value;
        },
      };

      const actualPatch = applyPatchState(targetState, { onOff: true });

      expect(actualPatch).toEqual({ onOff: true });
      expect(targetState._onOff).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(targetState._onOff).toBe(true);
      expect(failCount).toBe(0);
    });

    it('should give up after MAX_RETRY_COUNT retries on persistent conflict', async () => {
      let failCount = 30;
      const targetState = {
        _onOff: false,
        get onOff(): boolean {
          return this._onOff;
        },
        set onOff(value: boolean) {
          if (failCount > 0) {
            failCount--;
            throw new Error('synchronous-transaction-conflict');
          }
          this._onOff = value;
        },
      };

      applyPatchState(targetState, { onOff: true });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(targetState._onOff).toBe(false);
      expect(failCount).toBe(9);
    });

    it('should handle ExpiredReferenceError gracefully on state read', () => {
      const targetState = {
        get onOff(): boolean {
          const err = new Error(
            'Referencing onOff.state: This value is no longer available because its context has exited (1)',
          );
          err.name = 'ExpiredReferenceError';
          throw err;
        },
        set onOff(value: boolean) {
          // should not reach here
        },
      };

      const actualPatch = applyPatchState(targetState, { onOff: true });
      expect(actualPatch).toEqual({});
    });

    it('should handle ExpiredReferenceError gracefully on state write', () => {
      const targetState = {
        _onOff: false,
        get onOff(): boolean {
          return this._onOff;
        },
        set onOff(value: boolean) {
          const err = new Error(
            'Referencing onOff.state: This value is no longer available because its context has exited (1)',
          );
          err.name = 'ExpiredReferenceError';
          throw err;
        },
      };

      const actualPatch = applyPatchState(targetState, { onOff: true });
      expect(actualPatch).toEqual({ onOff: true });
    });

    it('should drop out-of-order patches with older sequences when a patch is pending', async () => {
      let failCount = 1;
      const targetState = {
        _onOff: false,
        get onOff(): boolean {
          return this._onOff;
        },
        set onOff(value: boolean) {
          if (failCount > 0) {
            failCount--;
            throw new Error('synchronous-transaction-conflict');
          }
          this._onOff = value;
        },
      };

      // 1. First update changes state from false to true, triggers a lock conflict and gets pending (seq = N)
      applyPatchState(targetState, { onOff: true });

      // 2. A delayed, older update (seq = 0) to change it back to false comes in
      const droppedPatch = applyPatchState(targetState, { onOff: false }, false, 0);

      // It must be dropped and return empty object
      expect(droppedPatch).toEqual({});

      // 3. Wait for retry timer to resolve the pending update
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Stale update (false) should be ignored, and targetState must remain true as requested by the latest command
      expect(targetState._onOff).toBe(true);
    });

    it('should drop out-of-order patches with older sequences even when no patch is pending', () => {
      const state = { onOff: false };

      // Apply initial patch with sequence 10
      applyPatchState(state, { onOff: true }, false, 10);
      expect(state.onOff).toBe(true);

      // A delayed feedback with sequence 5 comes in
      const droppedPatch = applyPatchState(state, { onOff: false }, false, 5);

      // It must be dropped and return empty object
      expect(droppedPatch).toEqual({});
      expect(state.onOff).toBe(true); // remains true
    });
  });

  describe('transactionIsOffline', () => {
    it('should return true if context is undefined or null', () => {
      expect(transactionIsOffline(undefined)).toBe(true);
      expect(transactionIsOffline(null)).toBe(true);
    });
  });
});
