import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateManager } from '../src/state/state-manager.js';
import { MqttPublisher } from '../src/transports/mqtt/publisher.js';
import { PacketProcessor } from '../src/protocol/packet-processor.js';
import { HomenetBridgeConfig } from '../src/config/types.js';
import { EventEmitter } from 'node:events';

describe('StateManager Merging', () => {
  let stateManager: StateManager;
  let mockPublisher: any;
  let mockPacketProcessor: any;
  let mockConfig: HomenetBridgeConfig;

  beforeEach(() => {
    mockPublisher = {
      publish: vi.fn(),
    } as unknown as MqttPublisher;

    mockPacketProcessor = new EventEmitter();
    mockPacketProcessor.processChunk = vi.fn();

    mockConfig = {
      serials: [
        {
          portId: 'main',
          path: '/dev/ttyUSB0',
          baud_rate: 9600,
          data_bits: 8,
          parity: 'none',
          stop_bits: 1,
        },
      ],
      mqtt: { brokerUrl: 'mqtt://localhost' },
    } as any;

    stateManager = new StateManager('main', mockConfig, mockPacketProcessor as any, mockPublisher);
  });

  it('should merge partial state updates', () => {
    const deviceId = 'climate1';

    // First update: temperature only
    mockPacketProcessor.emit('state', {
      deviceId,
      state: { current_temperature: 24 },
    });

    expect(mockPublisher.publish).toHaveBeenLastCalledWith(
      `homenet/main/${deviceId}/state`,
      JSON.stringify({ current_temperature: 24 }),
      { retain: true },
    );

    // Second update: target temperature only
    mockPacketProcessor.emit('state', {
      deviceId,
      state: { target_temperature: 26 },
    });

    // Expect merged state
    expect(mockPublisher.publish).toHaveBeenLastCalledWith(
      `homenet/main/${deviceId}/state`,
      JSON.stringify({ current_temperature: 24, target_temperature: 26 }),
      { retain: true },
    );

    // Third update: update existing property
    mockPacketProcessor.emit('state', {
      deviceId,
      state: { current_temperature: 25 },
    });

    // Expect merged state with updated value
    expect(mockPublisher.publish).toHaveBeenLastCalledWith(
      `homenet/main/${deviceId}/state`,
      JSON.stringify({ current_temperature: 25, target_temperature: 26 }),
      { retain: true },
    );
  });
});
