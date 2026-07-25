import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IlluminanceMeasurementServer } from '../../../../src/transports/matter/behaviors/illuminance-measurement-server.js';
import { HomenetEntityBehavior } from '../../../../src/transports/matter/behaviors/homenet-entity-behavior.js';
import { applyPatchState } from '../../../../src/transports/matter/utils/apply-patch-state.js';
import { IlluminanceMeasurementServer as Base } from '@matter/main/behaviors';

vi.mock('../../../../src/transports/matter/utils/apply-patch-state.js', () => ({
  applyPatchState: vi.fn(),
}));

describe('IlluminanceMeasurementServer', () => {
  let server: any;
  let homenetMock: any;
  let agentMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    homenetMock = {
      entityState: { illuminance: 100 },
      onChange: {
        on: vi.fn(),
      },
    };

    agentMock = {
      load: vi.fn().mockResolvedValue(homenetMock),
    };

    // Use an object that binds properly without invoking getters from the base class
    server = {
      get agent() {
        return agentMock;
      },
      state: {},
      update: IlluminanceMeasurementServer.prototype['update'],
      initialize: IlluminanceMeasurementServer.prototype.initialize,
      reactTo: vi.fn(),
    };

    // Bind the functions to our mock server context
    server.update = server.update.bind(server);
    server.initialize = server.initialize.bind(server);
  });

  describe('update', () => {
    it('should correctly parse measuredValue from lux (illuminance property)', () => {
      // 100 lux -> 10000 * log10(100) + 1 = 10000 * 2 + 1 = 20001
      server.update({ illuminance: 100 });
      expect(applyPatchState).toHaveBeenCalledWith(server.state, { measuredValue: 20001 });
    });

    it('should handle lux values < 1 by setting measuredValue to 0', () => {
      server.update({ illuminance: 0.5 });
      expect(applyPatchState).toHaveBeenCalledWith(server.state, { measuredValue: 0 });
    });

    it('should use state_number if illuminance is not present', () => {
      server.update({ state_number: 10 });
      // 10 lux -> 10000 * 1 + 1 = 10001
      expect(applyPatchState).toHaveBeenCalledWith(server.state, { measuredValue: 10001 });
    });

    it('should use state if neither illuminance nor state_number is present', () => {
      server.update({ state: 1000 });
      // 1000 lux -> 10000 * 3 + 1 = 30001
      expect(applyPatchState).toHaveBeenCalledWith(server.state, { measuredValue: 30001 });
    });

    it('should handle string values by parsing them to float', () => {
      server.update({ illuminance: '100.5' });
      // 100.5 lux -> 10000 * ~2.00216 + 1 = 20023
      expect(applyPatchState).toHaveBeenCalledWith(server.state, { measuredValue: 20023 });
    });

    it('should clamp measuredValue to max 0xfffe (65534)', () => {
      // Very high lux value that would exceed max
      // 100000000 lux -> 10000 * 8 + 1 = 80001 (which is > 65534)
      server.update({ illuminance: 100000000 });
      expect(applyPatchState).toHaveBeenCalledWith(server.state, { measuredValue: 65534 });
    });

    it('should set measuredValue to null if value cannot be parsed', () => {
      server.update({ illuminance: 'not a number' });
      expect(applyPatchState).toHaveBeenCalledWith(server.state, { measuredValue: null });
    });

    it('should set measuredValue to null if entityState is null/undefined', () => {
      server.update(null);
      expect(applyPatchState).toHaveBeenCalledWith(server.state, { measuredValue: null });
    });
  });

  describe('initialize', () => {
    let baseInitializeSpy: any;

    beforeEach(() => {
      baseInitializeSpy = vi.spyOn(Base.prototype, 'initialize').mockResolvedValue(undefined);
    });

    afterEach(() => {
      if (baseInitializeSpy) {
        baseInitializeSpy.mockRestore();
      }
    });

    it('should load homenet entity and setup reactivity', async () => {
      // Create a mocked instance of IlluminanceMeasurementServer
      // avoiding instantiating the real Base class
      const instance = {
        get agent() {
          return agentMock;
        },
        state: {},
        update: vi.fn(),
        reactTo: vi.fn(),
        initialize: IlluminanceMeasurementServer.prototype.initialize,
      };

      // We need to mock super.initialize
      // Since it's a class inheritance, doing it dynamically
      const baseInitializeSpy = vi.spyOn(Base.prototype, 'initialize').mockResolvedValue(undefined);

      // We have to bind `initialize` so `super` works?
      // Since we can't easily mock `super` directly in a POJO, we'll try something else

      // Let's create an actual instance but mock get agent
      const realInstance = Object.create(IlluminanceMeasurementServer.prototype);
      Object.defineProperty(realInstance, 'agent', { get: () => agentMock });
      Object.defineProperty(realInstance, 'state', { value: {}, writable: true });
      realInstance.reactTo = vi.fn();

      const updateSpy = vi.spyOn(realInstance as any, 'update').mockImplementation(() => {});

      await realInstance.initialize();

      expect(baseInitializeSpy).toHaveBeenCalled();
      expect(agentMock.load).toHaveBeenCalledWith(HomenetEntityBehavior);
      expect(updateSpy).toHaveBeenCalledWith(homenetMock.entityState);
      expect(realInstance.reactTo).toHaveBeenCalledWith(
        homenetMock.onChange,
        realInstance['update'],
        { offline: true },
      );
    });
  });
});
