import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from '../../src/state/state-manager.js';
import { PacketProcessor } from '../../src/protocol/packet-processor.js';
import { MqttPublisher } from '../../src/transports/mqtt/publisher.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';

describe('StateManager', () => {
  let stateManager: StateManager;
  let mockPacketProcessor: PacketProcessor;
  let mockMqttPublisher: MqttPublisher;
  let config: HomenetBridgeConfig;

  beforeEach(() => {
    mockPacketProcessor = {
      on: vi.fn(),
      processChunk: vi.fn(),
    } as any;
    mockMqttPublisher = {
      publish: vi.fn(),
    } as any;
    config = {
      serial: {
        portId: 'serial1',
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      light: [
        { id: 'light1', name: 'Light 1', type: 'light', optimistic: true } as any,
        { id: 'light2', name: 'Light 2', type: 'light', optimistic: false } as any,
      ],
    };

    stateManager = new StateManager(
      'test-port',
      config,
      mockPacketProcessor,
      mockMqttPublisher,
      'homenet',
    );
  });

  describe('getAllStates Caching', () => {
    it('should return the same object reference on multiple calls if state allows caching logic', () => {
      // Note: This test verifies behavior that is NOT YET implemented.
      // It serves as a verification for the upcoming optimization.

      // Initial call
      const state1 = stateManager.getAllStates();

      // Second call
      const state2 = stateManager.getAllStates();

      // WITH caching (target behavior), this should be equal
      // BUT current implementation returns new object every time.
      // We will assert current behavior first, then update test or code.
      // Actually, let's write the test for the DESIRED behavior, so it fails first (TDD).
      // However, to avoid breaking everything immediately, I will check if they are deep equal but not same ref currently.

      expect(state1).toBe(state2);
      // Once optimization is applied, this should be toBe(state2)
    });

    it('should invalidate cache when state updates', () => {
      const state1 = stateManager.getAllStates();

      stateManager.updateEntityState('light1', { state: 'on' });

      const state2 = stateManager.getAllStates();

      expect(state2['light1'].state).toBe('on');
      expect(state1).not.toBe(state2); // Should be different objects
    });

    it('should NOT invalidate cache when state update results in NO change', () => {
      // First, set initial state
      stateManager.updateEntityState('light1', { state: 'on' });
      const state1 = stateManager.getAllStates();

      // Update with SAME value
      stateManager.updateEntityState('light1', { state: 'on' });
      const state2 = stateManager.getAllStates();

      // Even without explicit caching logic, StateManager tries to avoid processing valid redundant updates?
      // Actually StateManager.applyStateUpdate checks for changes.
      // If no changes, it returns early.

      expect(state1).toBe(state2);
    });
  });
});
