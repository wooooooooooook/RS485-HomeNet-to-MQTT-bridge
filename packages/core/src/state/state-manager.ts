// packages/core/src/state/state-manager.ts

import { Buffer } from 'buffer';
import { HomenetBridgeConfig } from '../config/types.js';
import { EntityConfig } from '../domain/entities/base.entity.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { logger } from '../utils/logger.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { eventBus } from '../service/event-bus.js';
import { stateCache } from './store.js'; // Import stateCache from store

export class StateManager {
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private config: HomenetBridgeConfig;
  private packetProcessor: PacketProcessor;
  private mqttPublisher: MqttPublisher;
  // Timestamp of the last received chunk (ms since epoch)
  private lastChunkTimestamp: number = 0;

  constructor(config: HomenetBridgeConfig, packetProcessor: PacketProcessor, mqttPublisher: MqttPublisher) {
    this.config = config;
    this.packetProcessor = packetProcessor;
    this.mqttPublisher = mqttPublisher;

    this.packetProcessor.on('state', (event: { deviceId: string; state: any }) => {
      this.handleStateUpdate(event);
    });
  }

  public processIncomingData(chunk: Buffer): void {
    this.packetProcessor.processChunk(chunk);
  }

  private handleStateUpdate(event: { deviceId: string; state: any }) {
    const { deviceId, state } = event;
    const topic = `homenet/${deviceId}/state`;
    const payload = JSON.stringify(state);

    if (stateCache.get(topic) !== payload) {
      stateCache.set(topic, payload);
      this.mqttPublisher.publish(topic, payload, { retain: false });
      eventBus.emit('state:changed', { entityId: deviceId, state: state });
      eventBus.emit(`device:${deviceId}:state:changed`, state);
      logger.info({ topic, payload }, '[core] MQTT 발행');
    }
  }
}
