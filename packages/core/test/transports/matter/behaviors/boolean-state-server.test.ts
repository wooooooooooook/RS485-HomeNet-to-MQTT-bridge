import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BooleanStateServer } from '../../../../src/transports/matter/behaviors/boolean-state-server.js';
import * as applyPatchStateModule from '../../../../src/transports/matter/utils/apply-patch-state.js';

// Mock the applyPatchState module
vi.mock('../../../../src/transports/matter/utils/apply-patch-state.js', () => ({
  applyPatchState: vi.fn(),
}));

describe('BooleanStateServer', () => {
  let server: any;
  let applyPatchStateSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    applyPatchStateSpy = vi.mocked(applyPatchStateModule.applyPatchState);

    // BooleanStateServer inherits from Base which might define state as a getter.
    // Instead of instantiating or assigning to state directly, we can define the property.
    server = Object.create(BooleanStateServer.prototype);
    Object.defineProperty(server, 'state', {
      value: { stateValue: false },
      writable: true,
      configurable: true,
    });
  });

  describe('update()', () => {
    it('should map "ON" to true', () => {
      server.update({ state: 'ON' });
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: true });
    });

    it('should map "OPEN" to true', () => {
      server.update({ state: 'OPEN' });
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: true });
    });

    it('should map "DETECTED" to true', () => {
      server.update({ state: 'DETECTED' });
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: true });
    });

    it('should map true to true', () => {
      server.update({ state: true });
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: true });
    });

    it('should map "OFF" to false', () => {
      server.update({ state: 'OFF' });
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: false });
    });

    it('should map "CLOSED" to false', () => {
      server.update({ state: 'CLOSED' });
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: false });
    });

    it('should map false to false', () => {
      server.update({ state: false });
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: false });
    });

    it('should map null to false', () => {
      server.update({ state: null });
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: false });
    });

    it('should map undefined state property to false', () => {
      server.update({});
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: false });
    });

    it('should map undefined entityState to false', () => {
      server.update(undefined);
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: false });
    });

    it('should map random string to false', () => {
      server.update({ state: 'RANDOM' });
      expect(applyPatchStateSpy).toHaveBeenCalledWith(server.state, { stateValue: false });
    });
  });
});
