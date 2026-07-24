import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ThermostatServer,
  ThermostatServerHeatingOnly,
  ThermostatServerCoolingOnly,
  ThermostatServerHeatingAndCooling,
} from '../../../../src/transports/matter/behaviors/thermostat-server.js';
import { Thermostat } from '@matter/main/clusters';
import SystemMode = Thermostat.SystemMode;

// Mock the transactionIsOffline utility so we don't have to construct full Matter.js contexts
vi.mock('../../../../src/transports/matter/utils/apply-patch-state.js', () => {
  return { applyPatchState: vi.fn((state, patch) => Object.assign(state, patch)) };
});
vi.mock('../../../../src/transports/matter/utils/transaction-is-offline.js', () => {
  return {
    transactionIsOffline: vi.fn((context) => {
      // For our tests, if we pass a special 'isMockOnline' flag, we treat it as online (return false)
      if (context && (context as any).isMockOnline) {
        return false;
      }
      return true;
    }),
  };
});

function createMockBehavior(
  BehaviorClass: any,
  features: any,
  entityConfigOverride: any = {},
  entityStateOverride: any = {},
) {
  const mockState: any = {};
  const mockEvents = {
    systemMode$Changed: {},
    occupiedHeatingSetpoint$Changed: {},
    occupiedCoolingSetpoint$Changed: {},
  };

  const executeCommandMock = vi.fn().mockResolvedValue({ success: true });

  let changeCallback: any;
  const mockOnChange = {
    on: vi.fn((cb) => {
      changeCallback = cb;
    }),
  };

  const mockHomenetEntity = {
    entityConfig: {
      id: 'climate_1',
      type: 'climate',
      visual: { min_temperature: 10, max_temperature: 30, temperature_step: 1 },
      ...entityConfigOverride,
    },
    entityState: {
      current_temperature: 20,
      target_temperature: 22,
      mode: 'heat',
      ...entityStateOverride,
    },
    entityId: 'climate_1',
    executeCommand: executeCommandMock,
    onChange: mockOnChange,
  };

  const mockAgent = {
    load: vi.fn().mockResolvedValue(mockHomenetEntity),
  };

  const reactToCalls: { event: any; callback: Function; options: any }[] = [];

  const instance = Object.create(BehaviorClass.prototype);
  Object.defineProperty(instance, 'state', { get: () => mockState });
  Object.defineProperty(instance, 'features', { get: () => features });
  Object.defineProperty(instance, 'events', { get: () => mockEvents });
  Object.defineProperty(instance, 'agent', { get: () => mockAgent });
  Object.defineProperty(instance, 'reactTo', {
    value: vi.fn((event, callback, options) => {
      reactToCalls.push({ event, callback, options });
    }),
  });

  // Mock the superclass initialize
  const BaseClass = Object.getPrototypeOf(BehaviorClass);
  if (!vi.isMockFunction(BaseClass.prototype.initialize)) {
    vi.spyOn(BaseClass.prototype, 'initialize').mockResolvedValue(undefined);
  }

  return {
    instance,
    mockState,
    mockEvents,
    executeCommandMock,
    reactToCalls,
    mockAgent,
    mockHomenetEntity,
  };
}

describe('ThermostatServer variants', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ThermostatServer (Full)', () => {
    it('initializes and handles events correctly', async () => {
      const { instance, mockState, reactToCalls, executeCommandMock, mockEvents } =
        createMockBehavior(ThermostatServer, { heating: true, cooling: true, autoMode: true });

      await instance.initialize();

      // Check pre-init limits logic
      expect(mockState.absMinHeatSetpointLimit).toBe(1000);
      expect(mockState.absMaxHeatSetpointLimit).toBe(3000);
      expect(mockState.absMinCoolSetpointLimit).toBe(1000);
      expect(mockState.absMaxCoolSetpointLimit).toBe(3000);
      expect(mockState.controlSequenceOfOperation).toBe(
        Thermostat.ControlSequenceOfOperation.CoolingAndHeating,
      );

      // Check post-init state update logic
      expect(mockState.localTemperature).toBe(2000);
      expect(mockState.systemMode).toBe(SystemMode.Heat);
      expect(mockState.occupiedHeatingSetpoint).toBe(2200);
      expect(mockState.occupiedCoolingSetpoint).toBe(2200);

      // Check event registrations
      const sysModeCb = reactToCalls.find(
        (c) => c.event === mockEvents.systemMode$Changed,
      )?.callback;
      const heatSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedHeatingSetpoint$Changed,
      )?.callback;
      const coolSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedCoolingSetpoint$Changed,
      )?.callback;

      expect(sysModeCb).toBeDefined();
      expect(heatSetCb).toBeDefined();
      expect(coolSetCb).toBeDefined();

      const mockContext = { isMockOnline: true };

      // Trigger system mode change
      await sysModeCb!.call(instance, SystemMode.Cool, SystemMode.Heat, mockContext);
      expect(executeCommandMock).toHaveBeenCalledWith('climate_1', 'cool');

      // Trigger heating setpoint change
      await heatSetCb!.call(instance, 2350, 2200, mockContext);
      // It should snap to step (which is 100). 2350 -> 2400.
      expect(executeCommandMock).toHaveBeenCalledWith('climate_1', 'temperature', 24);

      // Trigger cooling setpoint change
      await coolSetCb!.call(instance, 2500, 2200, mockContext);
      expect(executeCommandMock).toHaveBeenCalledWith('climate_1', 'temperature', 25);
    });
  });

  describe('ThermostatServer initialization edge cases', () => {
    it('sets wide defaults when visual configuration is missing', async () => {
      const { instance, mockState } = createMockBehavior(
        ThermostatServer,
        { heating: true, cooling: true, autoMode: true },
        { visual: undefined }, // No visual config
        { current_temperature: null, target_temperature: null }, // No state
      );

      await instance.initialize();

      expect(mockState.absMinHeatSetpointLimit).toBe(0); // 0 C
      expect(mockState.absMaxHeatSetpointLimit).toBe(5000); // 50 C
      expect(mockState.localTemperature).toBeNull();
      expect(mockState.occupiedHeatingSetpoint).toBe(2000); // shouldn't override defaults with null
    });

    it('correctly updates local state when entityState changes', async () => {
      const { instance, mockState, reactToCalls, mockHomenetEntity } = createMockBehavior(
        ThermostatServer,
        { heating: true, cooling: false, autoMode: false },
      );

      await instance.initialize();

      // Find the entity state change listener
      const onChangeCb = reactToCalls.find((c) => c.event === mockHomenetEntity.onChange)?.callback;
      expect(onChangeCb).toBeDefined();

      // Emit new entity state
      await onChangeCb!.call(instance, {
        current_temperature: 25.5,
        target_temperature: 24,
        mode: 'heat',
      });

      expect(mockState.localTemperature).toBe(2550);
      expect(mockState.occupiedHeatingSetpoint).toBe(2400);
      expect(mockState.systemMode).toBe(SystemMode.Heat);
    });
  });

  describe('ThermostatServer reactivity', () => {
    it('does nothing if context is offline', async () => {
      const { instance, reactToCalls, executeCommandMock, mockEvents } = createMockBehavior(
        ThermostatServer,
        { heating: true, cooling: true, autoMode: true },
      );

      await instance.initialize();

      const sysModeCb = reactToCalls.find(
        (c) => c.event === mockEvents.systemMode$Changed,
      )?.callback;
      const heatSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedHeatingSetpoint$Changed,
      )?.callback;

      // Pass a context that does not have isMockOnline: true. Our mock returns true for isOffline.
      const offlineContext = {};

      await sysModeCb!.call(instance, SystemMode.Cool, SystemMode.Heat, offlineContext);
      await heatSetCb!.call(instance, 2350, 2200, offlineContext);

      expect(executeCommandMock).not.toHaveBeenCalled();
    });

    it('maps systemMode to the correct homenet commands', async () => {
      const { instance, reactToCalls, executeCommandMock, mockEvents } = createMockBehavior(
        ThermostatServer,
        { heating: true, cooling: true, autoMode: true },
      );

      await instance.initialize();
      const sysModeCb = reactToCalls.find(
        (c) => c.event === mockEvents.systemMode$Changed,
      )?.callback;
      const mockContext = { isMockOnline: true };

      const modeMappings = [
        { matterMode: SystemMode.Heat, cmd: 'heat' },
        { matterMode: SystemMode.Cool, cmd: 'cool' },
        { matterMode: SystemMode.Auto, cmd: 'auto' },
        { matterMode: SystemMode.Dry, cmd: 'dry' },
        { matterMode: SystemMode.FanOnly, cmd: 'fan_only' },
        { matterMode: SystemMode.Off, cmd: 'off' },
      ];

      for (const map of modeMappings) {
        await sysModeCb!.call(instance, map.matterMode, SystemMode.Off, mockContext);
        expect(executeCommandMock).toHaveBeenCalledWith('climate_1', map.cmd);
      }
    });

    it('snaps setpoints correctly depending on visual.temperature_step', async () => {
      const { instance, reactToCalls, executeCommandMock, mockEvents, mockState } =
        createMockBehavior(
          ThermostatServer,
          { heating: true, cooling: false, autoMode: false },
          { visual: { temperature_step: 0.5 } }, // Matter step is 50
        );

      await instance.initialize();
      const heatSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedHeatingSetpoint$Changed,
      )?.callback;
      const mockContext = { isMockOnline: true };

      // Input 23.3°C (2330). Step is 0.5 (50). Rounding 2330/50 = 46.6 => 47 * 50 = 2350.
      await heatSetCb!.call(instance, 2330, 2200, mockContext);
      expect(executeCommandMock).toHaveBeenCalledWith('climate_1', 'temperature', 23.5);

      // Input 23.2°C (2320). Rounding 2320/50 = 46.4 => 46 * 50 = 2300.
      await heatSetCb!.call(instance, 2320, 2200, mockContext);
      expect(executeCommandMock).toHaveBeenCalledWith('climate_1', 'temperature', 23.0);
    });
  });

  describe('ThermostatServerHeatingOnly', () => {
    it('initializes and handles events for heating only', async () => {
      const { instance, mockState, reactToCalls, executeCommandMock, mockEvents } =
        createMockBehavior(ThermostatServerHeatingOnly, {
          heating: true,
          cooling: false,
          autoMode: false,
        });

      await instance.initialize();

      expect(mockState.absMinHeatSetpointLimit).toBe(1000);
      expect(mockState.controlSequenceOfOperation).toBe(
        Thermostat.ControlSequenceOfOperation.HeatingOnly,
      );

      // Cooling limits should not be present
      expect(mockState.absMinCoolSetpointLimit).toBeUndefined();

      const heatSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedHeatingSetpoint$Changed,
      )?.callback;
      const coolSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedCoolingSetpoint$Changed,
      )?.callback;

      expect(heatSetCb).toBeDefined();
      expect(coolSetCb).toBeUndefined(); // Shouldn't react to cooling

      const mockContext = { isMockOnline: true };
      await heatSetCb!.call(instance, 2300, 2200, mockContext);
      expect(executeCommandMock).toHaveBeenCalledWith('climate_1', 'temperature', 23);
    });
  });

  describe('ThermostatServerCoolingOnly', () => {
    it('initializes and handles events for cooling only', async () => {
      const { instance, mockState, reactToCalls, executeCommandMock, mockEvents } =
        createMockBehavior(ThermostatServerCoolingOnly, {
          heating: false,
          cooling: true,
          autoMode: false,
        });

      await instance.initialize();

      expect(mockState.absMinCoolSetpointLimit).toBe(1000);
      expect(mockState.controlSequenceOfOperation).toBe(
        Thermostat.ControlSequenceOfOperation.CoolingOnly,
      );

      expect(mockState.absMinHeatSetpointLimit).toBeUndefined();

      const heatSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedHeatingSetpoint$Changed,
      )?.callback;
      const coolSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedCoolingSetpoint$Changed,
      )?.callback;

      expect(heatSetCb).toBeUndefined(); // Shouldn't react to heating
      expect(coolSetCb).toBeDefined();

      const mockContext = { isMockOnline: true };
      await coolSetCb!.call(instance, 2300, 2200, mockContext);
      expect(executeCommandMock).toHaveBeenCalledWith('climate_1', 'temperature', 23);
    });
  });

  describe('ThermostatServerHeatingAndCooling', () => {
    it('initializes and handles events for heating and cooling without auto mode', async () => {
      const { instance, mockState, reactToCalls, executeCommandMock, mockEvents } =
        createMockBehavior(ThermostatServerHeatingAndCooling, {
          heating: true,
          cooling: true,
          autoMode: false,
        });

      await instance.initialize();

      expect(mockState.absMinCoolSetpointLimit).toBe(1000);
      expect(mockState.absMinHeatSetpointLimit).toBe(1000);
      expect(mockState.minSetpointDeadBand).toBeUndefined(); // autoMode is false

      const heatSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedHeatingSetpoint$Changed,
      )?.callback;
      const coolSetCb = reactToCalls.find(
        (c) => c.event === mockEvents.occupiedCoolingSetpoint$Changed,
      )?.callback;

      expect(heatSetCb).toBeDefined();
      expect(coolSetCb).toBeDefined();

      const mockContext = { isMockOnline: true };
      await coolSetCb!.call(instance, 2300, 2200, mockContext);
      expect(executeCommandMock).toHaveBeenCalledWith('climate_1', 'temperature', 23);
      await heatSetCb!.call(instance, 2100, 2000, mockContext);
      expect(executeCommandMock).toHaveBeenCalledWith('climate_1', 'temperature', 21);
    });
  });
});
