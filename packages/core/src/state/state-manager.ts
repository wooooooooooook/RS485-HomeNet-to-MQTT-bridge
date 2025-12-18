// packages/core/src/state/state-manager.ts

import { Buffer } from 'buffer';
import { HomenetBridgeConfig } from '../config/types.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { logger } from '../utils/logger.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { eventBus } from '../service/event-bus.js';
import { stateCache } from './store.js';

export class StateManager {
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private config: HomenetBridgeConfig;
  private packetProcessor: PacketProcessor;
  private mqttPublisher: MqttPublisher;
  private portId: string;
  private mqttTopicPrefix: string;
  private ignoredEntityId: string | null = null;
  // Timestamp of the last received chunk (ms since epoch)
  private lastChunkTimestamp: number = 0;
  private sharedStates?: Map<string, Record<string, any>>;

  constructor(
    portId: string,
    config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    mqttPublisher: MqttPublisher,
    mqttTopicPrefix: string,
    sharedStates?: Map<string, Record<string, any>>,
  ) {
    this.portId = portId;
    this.config = config;
    this.packetProcessor = packetProcessor;
    this.mqttPublisher = mqttPublisher;
    this.mqttTopicPrefix = mqttTopicPrefix;
    this.sharedStates = sharedStates;

    if (typeof (this.packetProcessor as any).on === 'function') {
      this.packetProcessor.on('state', (event: { deviceId: string; state: any }) => {
        this.handleStateUpdate(event);
      });
    } else {
      logger.warn(
        '[StateManager] PacketProcessor does not support events; state updates will not be processed automatically',
      );
    }
  }

  public setIgnoreEntity(entityId: string | null) {
    this.ignoredEntityId = entityId;
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

    if (this.ignoredEntityId && deviceId === this.ignoredEntityId) {
      return;
    }

    const currentState = this.deviceStates.get(deviceId) || {};
    const newState = { ...currentState, ...state };
    this.deviceStates.set(deviceId, newState);

    // Update shared global state if available
    if (this.sharedStates) {
      this.sharedStates.set(deviceId, newState);
    }

    const topic = `${this.mqttTopicPrefix}/${deviceId}/state`;
    const payload = JSON.stringify(newState);

    if (stateCache.get(topic) !== payload) {
      stateCache.set(topic, payload);
      if (logger.isLevelEnabled('info')) {
        const stateStr = JSON.stringify(newState).replace(/["{}]/g, '').replace(/,/g, ', ');
        logger.info(`[StateManager] ${deviceId}: {${stateStr}} → ${topic} [published]`);
      }
      this.mqttPublisher.publish(topic, payload, { retain: true });
      const timestamp = new Date().toISOString();
      eventBus.emit('state:changed', {
        portId: this.portId,
        entityId: deviceId,
        topic,
        payload,
        state: newState,
        oldState: currentState,
        changes: state,
        timestamp,
      });
      eventBus.emit(`device:${deviceId}:state:changed`, newState);
    } else {
      if (logger.isLevelEnabled('debug')) {
        const stateStr = JSON.stringify(newState).replace(/["{}]/g, '').replace(/,/g, ', ');
        logger.debug(`[StateManager] ${deviceId}: {${stateStr}} [unchanged]`);
      }
    }
  }
}
