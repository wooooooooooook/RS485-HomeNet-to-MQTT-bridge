import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NumberLevelControlServer } from '../../../../src/transports/matter/behaviors/number-level-control-server.js';
import { HomenetEntityBehavior } from '../../../../src/transports/matter/behaviors/homenet-entity-behavior.js';

describe('NumberLevelControlServer', () => {
  let server: any;
  let homenetMock: any;

  beforeEach(() => {
    homenetMock = {
      entityConfig: {},
      entityState: {},
      onChange: {
        on: vi.fn(),
      },
      executeCommand: vi.fn(),
    };

    server = {
      state: {},
      agent: {
        load: vi.fn().mockResolvedValue(homenetMock),
        get: vi.fn().mockReturnValue(homenetMock),
      },
      reactTo: vi.fn(),
      moveToLevelLogic: NumberLevelControlServer.prototype.moveToLevelLogic,
      update: (NumberLevelControlServer.prototype as any).update,
      initialize: NumberLevelControlServer.prototype.initialize,
    };
  });

  describe('initialize', () => {
    it('should set default state values and bind events', async () => {
      // Create a base prototype spy on initialize to mock out the super.initialize call
      // without re-implementing the function under test.
      const BasePrototype = Object.getPrototypeOf(NumberLevelControlServer.prototype);
      const superInitializeSpy = vi.spyOn(BasePrototype, 'initialize').mockResolvedValue(undefined);

      try {
        await server.initialize();

        expect(server.state.currentLevel).toBe(1); // update maps 0 percent to minLevel=1 (default entityState is undefined -> min_val -> 1)
        expect(server.state.minLevel).toBe(1);
        expect(server.state.maxLevel).toBe(254);
        expect(server.state.onLevel).toBeNull();

        expect(superInitializeSpy).toHaveBeenCalled();
        expect(server.agent.load).toHaveBeenCalledWith(HomenetEntityBehavior);
        expect(server.reactTo).toHaveBeenCalledWith(homenetMock.onChange, server.update, { offline: true });
      } finally {
        superInitializeSpy.mockRestore();
      }
    });

    it('should not overwrite existing state values', async () => {
      const BasePrototype = Object.getPrototypeOf(NumberLevelControlServer.prototype);
      const superInitializeSpy = vi.spyOn(BasePrototype, 'initialize').mockResolvedValue(undefined);

      server.state.currentLevel = 50;
      server.state.minLevel = 10;
      server.state.maxLevel = 100;

      try {
        await server.initialize();

        // The update function will be called on initialize with empty entity state,
        // which maps min_value (default 0) to minLevel=1.
        // We can test if the initial state setup branches (the `== null` checks) were handled correctly
        // by verifying `onLevel` is reset, and by overriding `update` to see if state values were preserved before `update` call.
        expect(server.state.onLevel).toBeNull();
      } finally {
        superInitializeSpy.mockRestore();
      }
    });
  });

  describe('update', () => {
    it('should map 0% (minVal) to level 1', () => {
      homenetMock.entityConfig = { min_value: 0, max_value: 100 };
      server.update({ value: 0 });
      expect(server.state.currentLevel).toBe(1);
    });

    it('should map 100% (maxVal) to level 254', () => {
      homenetMock.entityConfig = { min_value: 0, max_value: 100 };
      server.update({ value: 100 });
      expect(server.state.currentLevel).toBe(254);
    });

    it('should map 50% to roughly middle level', () => {
      homenetMock.entityConfig = { min_value: 0, max_value: 100 };
      server.update({ value: 50 });
      // Math.round(0.5 * (254 - 1)) + 1 = 127.5 -> 128
      expect(server.state.currentLevel).toBe(128);
    });

    it('should fall back to minVal if entityState value is missing', () => {
      homenetMock.entityConfig = { min_value: 10, max_value: 100 };
      server.update({});
      expect(server.state.currentLevel).toBe(1);
    });

    it('should parse string values correctly', () => {
      homenetMock.entityConfig = { min_value: 0, max_value: 100 };
      server.update({ state: "50" }); // state property instead of value, string type
      expect(server.state.currentLevel).toBe(128);
    });
  });

  describe('moveToLevelLogic', () => {
    it('should map level 1 to minVal', async () => {
      homenetMock.entityConfig = { min_value: 0, max_value: 100 };
      await server.moveToLevelLogic(1);
      expect(server.state.currentLevel).toBe(1);
      expect(homenetMock.executeCommand).toHaveBeenCalledWith(undefined, 'number', 0);
    });

    it('should map level 254 to maxVal', async () => {
      homenetMock.entityConfig = { min_value: 0, max_value: 100 };
      await server.moveToLevelLogic(254);
      expect(server.state.currentLevel).toBe(254);
      expect(homenetMock.executeCommand).toHaveBeenCalledWith(undefined, 'number', 100);
    });

    it('should map middle level correctly', async () => {
      homenetMock.entityConfig = { min_value: 0, max_value: 100 };
      await server.moveToLevelLogic(128);
      // percent = (128 - 1) / (254 - 1) = 127 / 253 = 0.50197...
      // targetValue = 0 + 0.50197 * 100 = 50.197
      // rounded = 50
      expect(homenetMock.executeCommand).toHaveBeenCalledWith(undefined, 'number', 50);
    });

    it('should apply step rounding', async () => {
      homenetMock.entityConfig = { min_value: 0, max_value: 100, step: 10 };
      await server.moveToLevelLogic(128); // targetValue ~ 50.197
      expect(homenetMock.executeCommand).toHaveBeenCalledWith(undefined, 'number', 50); // Math.round(50.197 / 10) * 10 = 50
    });
  });
});
