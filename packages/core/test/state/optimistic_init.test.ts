import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from '../../src/state/state-manager.js';
import { PacketProcessor } from '../../src/protocol/packet-processor.js';
import { MqttPublisher } from '../../src/transports/mqtt/publisher.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';

describe('StateManager Optimistic Initialization', () => {
  let stateManager: StateManager;
  let mockPacketProcessor: PacketProcessor;
  let mockMqttPublisher: MqttPublisher;
  let config: HomenetBridgeConfig;
  const PORT_ID = 'test-port';
  const TOPIC_PREFIX = 'homenet';

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
        portId: PORT_ID,
        path: '/dev/mock',
      },
      switch: [
        {
          id: 'virtual_switch',
          name: 'Virtual Switch',
          type: 'switch',
          optimistic: true,
          // No command or data, purely virtual
        } as any,
      ],
    };
  });

  it('should publish initial state for optimistic entities on startup', () => {
    stateManager = new StateManager(
      PORT_ID,
      config,
      mockPacketProcessor,
      mockMqttPublisher,
      TOPIC_PREFIX,
    );

    // Check if state is stored internally
    const state = stateManager.getEntityState('virtual_switch');
    expect(state).toEqual({ state: 'OFF' });

    // Check if state was published to MQTT
    // The topic should be prefix/entityId/state
    const expectedTopic = `${TOPIC_PREFIX}/virtual_switch/state`;
    const expectedPayload = JSON.stringify({ state: 'OFF' });

    expect(mockMqttPublisher.publish).toHaveBeenCalledWith(
      expectedTopic,
      expectedPayload,
      expect.objectContaining({ retain: true }),
    );
  });
});
