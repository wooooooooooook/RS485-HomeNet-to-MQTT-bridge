import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from '../../src/state/state-manager.js';
import { PacketProcessor } from '../../src/protocol/packet-processor.js';
import { MqttPublisher } from '../../src/transports/mqtt/publisher.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';
import { eventBus } from '../../src/service/event-bus.js';

describe('StateManager Optimistic Initialization', () => {
  let stateManager: StateManager;
  let mockPacketProcessor: PacketProcessor;
  let mockMqttPublisher: MqttPublisher;
  let config: HomenetBridgeConfig;
  const PORT_ID = 'test-port';
  const TOPIC_PREFIX = 'homenet';

  beforeEach(async () => {
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
      } as any,
      switch: [
        {
          id: 'virtual_switch',
          name: 'Virtual Switch',
          type: 'switch',
          optimistic: true,
          // No restore_mode → defaults to ALWAYS_OFF
        } as any,
      ],
    };
  });

  it('should publish initial OFF state for ALWAYS_OFF (default) optimistic entities', async () => {
    stateManager = new StateManager(
      PORT_ID,
      config,
      mockPacketProcessor,
      mockMqttPublisher,
      TOPIC_PREFIX,
    );
    await stateManager.init();

    const state = stateManager.getEntityState('virtual_switch');
    expect(state).toEqual({ state: 'OFF' });

    const expectedTopic = `${TOPIC_PREFIX}/virtual_switch/state`;
    const expectedPayload = JSON.stringify({ state: 'OFF' });

    expect(mockMqttPublisher.publish).toHaveBeenCalledWith(
      expectedTopic,
      expectedPayload,
      expect.objectContaining({ retain: true }),
    );
  });

  it('should publish initial ON state for ALWAYS_ON optimistic entities', async () => {
    config.switch = [
      {
        id: 'always_on_switch',
        name: 'Always On Switch',
        type: 'switch',
        optimistic: true,
        restore_mode: 'ALWAYS_ON',
      } as any,
    ];

    stateManager = new StateManager(
      PORT_ID,
      config,
      mockPacketProcessor,
      mockMqttPublisher,
      TOPIC_PREFIX,
    );
    await stateManager.init();

    const state = stateManager.getEntityState('always_on_switch');
    expect(state).toEqual({ state: 'ON' });

    expect(mockMqttPublisher.publish).toHaveBeenCalledWith(
      `${TOPIC_PREFIX}/always_on_switch/state`,
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );
  });

  it('should defer initial state for RESTORE_DEFAULT_OFF optimistic entities', async () => {
    config.switch = [
      {
        id: 'restorable_switch',
        name: 'Restorable Switch',
        type: 'switch',
        optimistic: true,
        restore_mode: 'RESTORE_DEFAULT_OFF',
      } as any,
    ];

    stateManager = new StateManager(
      PORT_ID,
      config,
      mockPacketProcessor,
      mockMqttPublisher,
      TOPIC_PREFIX,
    );
    await stateManager.init();

    expect(stateManager.getEntityState('restorable_switch')).toBeUndefined();
    expect(mockMqttPublisher.publish).not.toHaveBeenCalled();

    stateManager.initializeRestorableOptimisticDefaults(config);

    expect(stateManager.getEntityState('restorable_switch')).toEqual({ state: 'OFF' });
    expect(mockMqttPublisher.publish).toHaveBeenCalledWith(
      `${TOPIC_PREFIX}/restorable_switch/state`,
      JSON.stringify({ state: 'OFF' }),
      expect.objectContaining({ retain: true }),
    );
  });

  it('should defer initial state for RESTORE_DEFAULT_ON and fallback to ON', async () => {
    config.switch = [
      {
        id: 'restorable_on_switch',
        name: 'Restorable ON Switch',
        type: 'switch',
        optimistic: true,
        restore_mode: 'RESTORE_DEFAULT_ON',
      } as any,
    ];

    stateManager = new StateManager(
      PORT_ID,
      config,
      mockPacketProcessor,
      mockMqttPublisher,
      TOPIC_PREFIX,
    );
    await stateManager.init();

    expect(stateManager.getEntityState('restorable_on_switch')).toBeUndefined();
    expect(mockMqttPublisher.publish).not.toHaveBeenCalled();

    stateManager.initializeRestorableOptimisticDefaults(config);

    expect(stateManager.getEntityState('restorable_on_switch')).toEqual({ state: 'ON' });
    expect(mockMqttPublisher.publish).toHaveBeenCalledWith(
      `${TOPIC_PREFIX}/restorable_on_switch/state`,
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );
  });

  it('should keep restored state instead of publishing default state', async () => {
    config.switch = [
      {
        id: 'restorable_switch',
        name: 'Restorable Switch',
        type: 'switch',
        optimistic: true,
        restore_mode: 'RESTORE_DEFAULT_OFF',
      } as any,
    ];

    stateManager = new StateManager(
      PORT_ID,
      config,
      mockPacketProcessor,
      mockMqttPublisher,
      TOPIC_PREFIX,
    );
    await stateManager.init();

    stateManager.restoreEntityState('restorable_switch', { state: 'ON' });
    stateManager.initializeRestorableOptimisticDefaults(config);

    expect(stateManager.getEntityState('restorable_switch')).toEqual({ state: 'ON' });
    expect(mockMqttPublisher.publish).toHaveBeenCalledWith(
      `${TOPIC_PREFIX}/restorable_switch/state`,
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );
  });

  it('should emit state:changed and device specific events when state is restored', async () => {
    stateManager = new StateManager(
      PORT_ID,
      config,
      mockPacketProcessor,
      mockMqttPublisher,
      TOPIC_PREFIX,
    );
    await stateManager.init();

    const emitSpy = vi.spyOn(eventBus, 'emit');

    stateManager.restoreEntityState('virtual_switch', { state: 'ON' });

    expect(emitSpy).toHaveBeenCalledWith(
      'state:changed',
      expect.objectContaining({
        portId: PORT_ID,
        entityId: 'virtual_switch',
        state: { state: 'ON' },
        changes: { state: 'ON' },
      }),
    );

    expect(emitSpy).toHaveBeenCalledWith('device:virtual_switch:state:changed', { state: 'ON' });

    emitSpy.mockRestore();
  });
});
