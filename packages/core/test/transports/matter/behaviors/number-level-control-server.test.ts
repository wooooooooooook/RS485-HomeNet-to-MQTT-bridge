import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NumberLevelControlServer } from '../../../../src/transports/matter/behaviors/number-level-control-server.js';
import { HomenetEntityBehavior } from '../../../../src/transports/matter/behaviors/homenet-entity-behavior.js';

vi.mock('../../../../src/transports/matter/behaviors/homenet-entity-behavior.js', () => ({
  HomenetEntityBehavior: class {
    static id = 'homenetEntity';
  },
}));

vi.mock('../../../../src/transports/matter/utils/apply-patch-state.js', () => ({
  applyPatchState: vi.fn((state, patch) => {
    Object.assign(state, patch);
  }),
}));

describe('NumberLevelControlServer', () => {
  let server: any;
  let mockHomenet: any;
  let reactToFn: any;
  let state: any;

  beforeEach(() => {
    vi.clearAllMocks();

    state = { currentLevel: null, minLevel: null, maxLevel: null, onLevel: null };
    reactToFn = vi.fn();
    mockHomenet = {
      entityConfig: { min_value: 0, max_value: 100, step: 1 },
      entityState: { value: 50 },
      onChange: {},
      entityId: 'test_entity',
      executeCommand: vi.fn().mockResolvedValue({ success: true }),
    };

    const AgentMock = class {
      async load(Behavior: any) {
        if (Behavior === HomenetEntityBehavior) return mockHomenet;
        return null;
      }
      get(Behavior: any) {
        if (Behavior === HomenetEntityBehavior) return mockHomenet;
        return null;
      }
    };
    const agent = new AgentMock();

    server = Object.create(NumberLevelControlServer.prototype);

    // Polyfill all the missing internals that @matter/main expects from a Behavior instance
    Object.defineProperty(server, 'state', { get: () => state });
    Object.defineProperty(server, 'agent', { get: () => agent });
    Object.defineProperty(server, 'events', { get: () => ({}) });
    Object.defineProperty(server, 'endpoint', { get: () => ({}) });
    Object.defineProperty(server, 'context', { get: () => ({}) });
    server.reactTo = reactToFn;

    // We avoid calling super.initialize() which deeply traverses the Matter node tree
    const origInit = server.initialize;
    server.initialize = async function () {
      // Mock `super.initialize()` locally in this instance before executing the real initialize
      // To do this we have to patch the prototype chain temporarily.
      const baseProto = Object.getPrototypeOf(Object.getPrototypeOf(this));
      const oldInit = baseProto.initialize;
      baseProto.initialize = async () => {};
      try {
        await origInit.call(this);
      } finally {
        baseProto.initialize = oldInit;
      }
    };
  });

  describe('initialize', () => {
    it('should initialize default state values and subscribe to homenet events', async () => {
      await server.initialize();

      expect(reactToFn).toHaveBeenCalledWith(mockHomenet.onChange, expect.any(Function), {
        offline: true,
      });
      expect(state.currentLevel).toBe(128);
    });

    it('should respect existing values if not null initially, but update will override currentLevel', async () => {
      state.currentLevel = 100;
      state.minLevel = 50;
      state.maxLevel = 200;

      await server.initialize();

      expect(state.minLevel).toBe(1);
      expect(state.maxLevel).toBe(254);
      expect(state.currentLevel).toBe(128);
    });
  });

  describe('update', () => {
    it('should map value to level correctly (50%)', async () => {
      mockHomenet.entityState = { value: 50 };
      await server.initialize();
      expect(state.currentLevel).toBe(128);
    });

    it('should map value to level correctly (0%)', async () => {
      mockHomenet.entityState = { value: 0 };
      await server.initialize();
      expect(state.currentLevel).toBe(1);
    });

    it('should map value to level correctly (100%)', async () => {
      mockHomenet.entityState = { value: 100 };
      await server.initialize();
      expect(state.currentLevel).toBe(254);
    });

    it('should parse string values', async () => {
      mockHomenet.entityState = { value: '75' };
      await server.initialize();
      expect(state.currentLevel).toBe(191);
    });

    it('should fallback to state property if value is undefined', async () => {
      mockHomenet.entityState = { state: 25 };
      await server.initialize();
      expect(state.currentLevel).toBe(64);
    });

    it('should default to minVal if entityState has no value/state', async () => {
      mockHomenet.entityState = {};
      await server.initialize();
      expect(state.currentLevel).toBe(1);
    });

    it('should cap values outside min/max bounds', async () => {
      mockHomenet.entityState = { value: 150 };
      await server.initialize();
      expect(state.currentLevel).toBe(254);

      mockHomenet.entityState = { value: -50 };
      await server.initialize();
      expect(state.currentLevel).toBe(1);
    });

    it('should use custom entityConfig min_value and max_value', async () => {
      mockHomenet.entityConfig = { min_value: 10, max_value: 30 };
      mockHomenet.entityState = { value: 20 };
      await server.initialize();
      expect(state.currentLevel).toBe(128);
    });
  });

  describe('moveToLevelLogic', () => {
    it('should calculate and execute correct value mapping to Homenet', async () => {
      await server.initialize();

      await server.moveToLevelLogic(128);
      expect(mockHomenet.executeCommand).toHaveBeenCalledWith('test_entity', 'number', 50);
      expect(state.currentLevel).toBe(128);
    });

    it('should apply step rounding correctly', async () => {
      mockHomenet.entityConfig.step = 10;
      await server.initialize();

      await server.moveToLevelLogic(64);
      expect(mockHomenet.executeCommand).toHaveBeenCalledWith('test_entity', 'number', 20);
    });

    it('should handle custom min/max correctly', async () => {
      mockHomenet.entityConfig = { min_value: 10, max_value: 30, step: 1 };
      await server.initialize();

      await server.moveToLevelLogic(254);
      expect(mockHomenet.executeCommand).toHaveBeenCalledWith('test_entity', 'number', 30);

      await server.moveToLevelLogic(1);
      expect(mockHomenet.executeCommand).toHaveBeenCalledWith('test_entity', 'number', 10);
    });
  });
});
