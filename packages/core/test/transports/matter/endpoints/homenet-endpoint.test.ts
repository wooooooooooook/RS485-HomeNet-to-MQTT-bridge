import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HomenetEndpoint } from '../../../../src/transports/matter/endpoints/homenet-endpoint.js';
import { HomenetEntityBehavior } from '../../../../src/transports/matter/behaviors/homenet-entity-behavior.js';
import type { EndpointType } from '@matter/main/node';

vi.mock('@matter/main', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@matter/main')>();

  class MockEndpoint {
    type: any;
    options: any;
    construction = {
      ready: Promise.resolve(),
    };

    constructor(type: any, options: any) {
      this.type = type;
      this.options = options;
    }

    stateOf(behavior: any) {
      return this.options[behavior.id] || {};
    }

    async setStateOf(behavior: any, state: any) {
      this.options[behavior.id] = { ...this.options[behavior.id], ...state };
    }
  }

  return {
    ...actual,
    Endpoint: MockEndpoint,
  };
});

describe('HomenetEndpoint', () => {
  const mockType = {} as EndpointType;
  const mockConfig = { id: 'light.living_room', type: 'light' };
  const mockInitialState = { on: true };
  const mockExecuteCommand = vi.fn().mockResolvedValue({ success: true });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should instantiate and initialize properties correctly', () => {
    const endpoint = new HomenetEndpoint(
      mockType,
      'light.living_room',
      mockConfig,
      mockInitialState,
      mockExecuteCommand,
    );

    expect(endpoint.entityId).toBe('light.living_room');
    expect(endpoint.executeCommand).toBe(mockExecuteCommand);

    // Verify how Endpoint constructor was called via the mocked class properties
    const mockEndpoint = endpoint as any;
    expect(mockEndpoint.type).toBe(mockType);
    expect(mockEndpoint.options.id).toBe('light_living_room');
    expect(mockEndpoint.options.homenetEntity).toEqual({
      entityConfig: mockConfig,
      entityState: mockInitialState,
    });
  });

  it('should update state successfully', async () => {
    const endpoint = new HomenetEndpoint(
      mockType,
      'light.living_room',
      mockConfig,
      mockInitialState,
      mockExecuteCommand,
    );

    // Initial state check
    let current = endpoint.stateOf(HomenetEntityBehavior).entityState;
    expect(current).toEqual({ on: true });

    // Update state
    await endpoint.updateState({ brightness: 100 });

    // Verify state was merged
    current = endpoint.stateOf(HomenetEntityBehavior).entityState;
    expect(current).toEqual({ on: true, brightness: 100 });

    // Overwrite state
    await endpoint.updateState({ on: false });

    current = endpoint.stateOf(HomenetEntityBehavior).entityState;
    expect(current).toEqual({ on: false, brightness: 100 });
  });

  it('should handle construction errors gracefully in updateState', async () => {
    const endpoint = new HomenetEndpoint(
      mockType,
      'light.living_room',
      mockConfig,
      mockInitialState,
      mockExecuteCommand,
    );

    // Mock construction.ready to reject
    const mockEndpoint = endpoint as any;
    mockEndpoint.construction.ready = Promise.reject(new Error('Construction failed'));

    // Should not throw, should just return
    await expect(endpoint.updateState({ on: false })).resolves.toBeUndefined();

    // Verify state was not changed
    const current = endpoint.stateOf(HomenetEntityBehavior).entityState;
    expect(current).toEqual({ on: true });
  });
});
