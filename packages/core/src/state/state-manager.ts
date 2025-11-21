// packages/core/src/state/state-manager.ts

import { Buffer } from 'buffer';
import { HomenetBridgeConfig } from '../config/types.js';
import { EntityConfig } from '../domain/entities/base.entity.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { logger } from '../utils/logger.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { eventBus } from '../service/event-bus.js';
import { stateCache, clearStateCache } from './store.js'; // Import clearStateCache

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
    logger.debug({ hex }, '[core] Received chunk');
    eventBus.emit('raw-data', hex);
    this.packetProcessor.processChunk(chunk);
  }

  private handleStateUpdate(event: { deviceId: string; state: any }) {
    const { deviceId, state } = event;
    logger.debug({ deviceId, state }, '[StateManager] Received state update event');

    const topic = `homenet/${deviceId}/state`;
    const payload = JSON.stringify(state);

    // const cachedPayload = stateCache.get(topic);
    // logger.debug({
    //   topic,
    //   newPayload: payload,
    //   cachedPayload,
    //   isDifferent: cachedPayload !== payload
    // }, '[StateManager] Comparing with cache');

    if (stateCache.get(topic) !== payload) {
      stateCache.set(topic, payload);
      logger.debug({ topic, payload }, '[StateManager] Publishing to MQTT');
      this.mqttPublisher.publish(topic, payload, { retain: true });
      eventBus.emit('state:changed', { entityId: deviceId, state: state });
      eventBus.emit(`device:${deviceId}:state:changed`, state);
    } else {
      logger.debug({ topic }, '[StateManager] State unchanged, skipping MQTT publish');
    }
  }
}
