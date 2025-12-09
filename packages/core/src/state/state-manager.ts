// packages/core/src/state/state-manager.ts

import { Buffer } from 'buffer';
import { HomenetBridgeConfig } from '../config/types.js';
import { EntityConfig } from '../domain/entities/base.entity.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { logger } from '../utils/logger.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { eventBus } from '../service/event-bus.js';
import { stateCache, clearStateCache } from './store.js'; // Import clearStateCache
import { MQTT_TOPIC_PREFIX } from '../utils/constants.js';

export class StateManager {
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private config: HomenetBridgeConfig;
  private packetProcessor: PacketProcessor;
  private mqttPublisher: MqttPublisher;
  // Timestamp of the last received chunk (ms since epoch)
  private lastChunkTimestamp: number = 0;

  constructor(
    config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    mqttPublisher: MqttPublisher,
  ) {
    this.config = config;
    this.packetProcessor = packetProcessor;
    this.mqttPublisher = mqttPublisher;

    // Clear state cache on initialization to force re-publishing all states
    clearStateCache();
    logger.info('[StateManager] State cache cleared on initialization');

    this.packetProcessor.on('state', (event: { deviceId: string; state: any }) => {
      this.handleStateUpdate(event);
    });
  }

  public processIncomingData(chunk: Buffer): void {
    // Emit raw data for the service/UI to consume
    const hex = chunk.toString('hex');
    logger.trace({ hex }, '[core] Received chunk');
    eventBus.emit('raw-data', hex);
    this.packetProcessor.processChunk(chunk);
  }

  private deviceStates = new Map<string, any>();

  private handleStateUpdate(event: { deviceId: string; state: any }) {
    const { deviceId, state } = event;

    const currentState = this.deviceStates.get(deviceId) || {};
    const newState = { ...currentState, ...state };
    this.deviceStates.set(deviceId, newState);

    const topic = `${MQTT_TOPIC_PREFIX}/${deviceId}/state`;
    const payload = JSON.stringify(newState);

    if (stateCache.get(topic) !== payload) {
      stateCache.set(topic, payload);
      const stateStr = JSON.stringify(newState).replace(/["{}]/g, '').replace(/,/g, ', ');
      logger.info(`[StateManager] ${deviceId}: {${stateStr}} → ${topic} [published]`);
      this.mqttPublisher.publish(topic, payload, { retain: true });
      const timestamp = new Date().toISOString();
      eventBus.emit('state:changed', {
        entityId: deviceId,
        topic,
        payload,
        state: newState,
        timestamp,
      });
      eventBus.emit(`device:${deviceId}:state:changed`, newState);
    } else {
      const stateStr = JSON.stringify(newState).replace(/["{}]/g, '').replace(/,/g, ', ');
      logger.debug(`[StateManager] ${deviceId}: {${stateStr}} [unchanged]`);
    }
  }
}
