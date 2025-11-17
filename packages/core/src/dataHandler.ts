// packages/core/src/dataHandler.ts

import { Buffer } from 'buffer';
import { HomenetBridgeConfig, EntityConfig } from './config.js';
import { PacketProcessor } from './packetProcessor.js';
import { logger } from './logger.js';
import mqtt from 'mqtt';

let receiveBuffer = Buffer.alloc(0);
const stateCache = new Map<string, any>();

// Export stateCache directly
export { stateCache };

// Add a getter for stateCache (optional, but good practice)
export function getStateCache() {
  return stateCache;
}

export function handleData(
  chunk: Buffer,
  config: HomenetBridgeConfig,
  packetProcessor: PacketProcessor,
  client: mqtt.MqttClient
) {
  logger.debug({ data: chunk.toString('hex') }, '[core] Raw data received');
  receiveBuffer = Buffer.concat([receiveBuffer, chunk]);

  const packetDefaults = config.packet_defaults;
  if (!packetDefaults || typeof packetDefaults.rx_length === 'undefined') {
    logger.error("[core] 'rx_length' is not defined in packet_defaults.");
    receiveBuffer = Buffer.alloc(0);
    return;
  }
  const packetLength = packetDefaults.rx_length;

  const entityTypes: (keyof HomenetBridgeConfig)[] = [
    'light',
    'climate',
    'valve',
    'button',
    'sensor',
    'fan',
    'switch',
    'binary_sensor',
  ];
  const allEntities: EntityConfig[] = entityTypes
    .map((type) => config[type] as EntityConfig[] | undefined)
    .filter((entities): entities is EntityConfig[] => !!entities)
    .flat();

  let bufferWasProcessed = true;
  while (receiveBuffer.length >= packetLength && bufferWasProcessed) {
    bufferWasProcessed = false;

    const packet = receiveBuffer.slice(0, packetLength);
    const parsedStates = packetProcessor.parseIncomingPacket(
      packet.toJSON().data,
      allEntities
    );

    if (parsedStates.length > 0) {
      parsedStates.forEach((parsed) => {
        const entity = allEntities.find((e) => e.id === parsed.entityId);
        if (entity) {
          const topic = `homenet/${entity.id}/state`;
          const payload = JSON.stringify(parsed.state);
          if (stateCache.get(topic) !== payload) {
            stateCache.set(topic, payload);
            client.publish(topic, payload, { retain: true });
            logger.info({ topic, payload }, '[core] MQTT 발행');
          }
        }
      });
      receiveBuffer = receiveBuffer.slice(packetLength);
      bufferWasProcessed = true;
    } else {
      receiveBuffer = receiveBuffer.slice(1);
      bufferWasProcessed = true;
    }
  }
}