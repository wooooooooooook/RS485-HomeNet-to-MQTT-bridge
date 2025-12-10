// packages/core/src/state/state-manager.ts

import { Buffer } from 'buffer';
import { HomenetBridgeConfig } from '../config/types.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { logger } from '../utils/logger.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { eventBus } from '../service/event-bus.js';
import { stateCache } from './store.js';
import { MQTT_TOPIC_PREFIX } from '../utils/constants.js';

export class StateManager {
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private config: HomenetBridgeConfig;
  private packetProcessor: PacketProcessor;
  private mqttPublisher: MqttPublisher;
  private portId: string;
  // Timestamp of the last received chunk (ms since epoch)
  private lastChunkTimestamp: number = 0;

  constructor(
    portId: string,
    config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    mqttPublisher: MqttPublisher,
  ) {
    this.portId = portId;
    this.config = config;
    this.packetProcessor = packetProcessor;
    this.mqttPublisher = mqttPublisher;

    if (typeof (this.packetProcessor as any).on === 'function') {
      this.packetProcessor.on('state', (event: { deviceId: string; state: any }) => {
        this.handleStateUpdate(event);
      });
    } else {
      logger.warn('[StateManager] PacketProcessor does not support events; state updates will not be processed automatically');
    }
  }

  public processIncomingData(chunk: Buffer): void {
    // Emit raw data for the service/UI to consume
    const hex = chunk.toString('hex');
    logger.trace({ hex }, '[core] Received chunk');
    eventBus.emit('raw-data', hex);
    this.packetProcessor.processChunk(chunk);
  }

  private deviceStates = new Map<string, any>();

  public getLightState(entityId: string): { isOn: boolean } | undefined {
    const state = this.deviceStates.get(entityId);
    if (state && typeof state.isOn === 'boolean') {
      return { isOn: state.isOn };
    }
    return undefined;
  }

  public getClimateState(entityId: string): { targetTemperature: number } | undefined {
    const state = this.deviceStates.get(entityId);
    if (state && typeof state.targetTemperature === 'number') {
      return { targetTemperature: state.targetTemperature };
    }
    return undefined;
  }

  private handleStateUpdate(event: { deviceId: string; state: any }) {
    const { deviceId, state } = event;

    const currentState = this.deviceStates.get(deviceId) || {};
    const newState = { ...currentState, ...state };
    this.deviceStates.set(deviceId, newState);

    const topic = `${MQTT_TOPIC_PREFIX}/${this.portId}/${deviceId}/state`;
    const payload = JSON.stringify(newState);

    if (stateCache.get(topic) !== payload) {
      stateCache.set(topic, payload);
      const stateStr = JSON.stringify(newState).replace(/["{}]/g, '').replace(/,/g, ', ');
      logger.info(`[StateManager] ${deviceId}: {${stateStr}} → ${topic} [published]`);
      this.mqttPublisher.publish(topic, payload, { retain: true });
      const timestamp = new Date().toISOString();
      eventBus.emit('state:changed', {
        portId: this.portId,
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
