// packages/core/src/transports/mqtt/subscriber.ts
import { MqttClient } from './mqtt.client.js';
import { HomenetBridgeConfig } from '../../config/types.js';
import { EntityConfig } from '../../domain/entities/base.entity.js';
import { logger } from '../../utils/logger.js';
import { PacketProcessor } from '../../protocol/packet-processor.js';
import { eventBus } from '../../service/event-bus.js';
import { CommandManager } from '../../service/command.manager.js';
import { MQTT_TOPIC_PREFIX } from '../../utils/constants.js';

export class MqttSubscriber {
  private mqttClient: MqttClient;
  private config: HomenetBridgeConfig;
  private packetProcessor: PacketProcessor;
  private commandManager: CommandManager;
  private externalHandlers: Map<string, (message: Buffer) => void> = new Map();

  constructor(
    mqttClient: MqttClient,
    config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    commandManager: CommandManager,
  ) {
    this.mqttClient = mqttClient;
    this.config = config;
    this.packetProcessor = packetProcessor;
    this.commandManager = commandManager;

    this.mqttClient.client.on('message', (topic, message) =>
      this.handleMqttMessage(topic, message),
    );
  }

  public setupSubscriptions(): void {
    const allEntityTypes = [
      'light',
      'climate',
      'valve',
      'button',
      'sensor',
      'fan',
      'switch',
      'binary_sensor',
    ];
    for (const entityType of allEntityTypes) {
      const entities = this.config[entityType as keyof HomenetBridgeConfig] as
        | EntityConfig[]
        | undefined;
      if (entities) {
        entities.forEach((entity) => {
          const baseTopic = `${MQTT_TOPIC_PREFIX}/${entity.id}`;
          // Subscribe to all subtopics under the entity's base topic
          // This matches /set, /mode/set, /temperature/set, /brightness/set, etc.
          this.mqttClient.client.subscribe(`${baseTopic}/#`, (err) => {
            if (err)
              logger.error(
                { err, topic: `${baseTopic}/#` },
                `[mqtt-subscriber] Failed to subscribe`,
              );
            else logger.info(`[mqtt-subscriber] Subscribed to ${baseTopic}/#`);
          });
        });
      }
    }
  }

  public subscribe(topic: string, handler: (message: Buffer) => void): void {
    this.externalHandlers.set(topic, handler);
    this.mqttClient.client.subscribe(topic, (err) => {
      if (err) {
        logger.error({ err, topic }, '[mqtt-subscriber] Failed to subscribe to external topic');
      } else {
        logger.info({ topic }, '[mqtt-subscriber] Subscribed to external topic');
      }
    });
  }

  private async handleMqttMessage(topic: string, message: Buffer) {
    if (!this.config || !this.packetProcessor || !this.commandManager) {
      logger.error(
        '[mqtt-subscriber] Configuration, PacketProcessor or CommandManager not initialized.',
      );
      return;
    }

    logger.debug({ topic, message: message.toString() }, '[mqtt-subscriber] MQTT 메시지 수신');

    if (this.externalHandlers.has(topic)) {
      this.externalHandlers.get(topic)!(message);
      return;
    }

    const parts = topic.split('/');

    // Validate topic format: {prefix}/{id}/.../set
    if (parts.length < 3 || parts[0] !== MQTT_TOPIC_PREFIX || parts[parts.length - 1] !== 'set') {
      // Silently ignore known system topics (state, availability, etc.)
      if (parts[0] === MQTT_TOPIC_PREFIX && parts.length >= 3) {
        const lastPart = parts[parts.length - 1];
        // Only warn if it's not a known system topic
        if (!['state', 'availability', 'attributes'].includes(lastPart)) {
          logger.warn({ topic }, `[mqtt-subscriber] Unhandled MQTT topic format`);
        }
      }
      return;
    }

    const entityId = parts[1];
    let commandName = '';
    const payload = message.toString();
    let commandValue: number | string | undefined = undefined;

    // Case 1: homenet/{id}/set (General command)
    if (parts.length === 3) {
      if (payload === 'ON') commandName = 'on';
      else if (payload === 'OFF') commandName = 'off';
      else if (payload === 'OPEN') commandName = 'open';
      else if (payload === 'CLOSE') commandName = 'close';
      else if (payload === 'STOP') commandName = 'stop';
      else if (payload === 'LOCK') commandName = 'lock';
      else if (payload === 'UNLOCK') commandName = 'unlock';
      else if (payload === 'PRESS') commandName = 'press';
      else {
        // For values (numbers, strings), we need to know the entity type to determine the command name
        // We'll defer this until we find the entity
        commandValue = payload;
      }
    }
    // Case 2: homenet/{id}/{attribute}/set (Specific attribute command)
    else if (parts.length === 4) {
      commandName = parts[2]; // e.g. temperature, mode, percentage, brightness, color_temp

      // Parse value
      const num = parseFloat(payload);
      if (!isNaN(num)) {
        commandValue = num;
      } else {
        commandValue = payload;
      }
    }

    const entityTypes: (keyof HomenetBridgeConfig)[] = [
      'light',
      'climate',
      'valve',
      'button',
      'sensor',
      'fan',
      'switch',
      'binary_sensor',
      'lock',
      'number',
      'select',
      'text',
      'text_sensor',
    ];

    let targetEntity: (EntityConfig & { type: string }) | undefined;

    for (const type of entityTypes) {
      const entities = this.config[type] as EntityConfig[] | undefined;
      if (entities) {
        const found = entities.find((e) => e.id === entityId);
        if (found) {
          targetEntity = { ...found, type };
          break;
        }
      }
    }

    if (targetEntity) {
      // Refine commandName based on entity type and payload

      // Button: PRESS -> on (Commonly mapped to command_on)
      if (targetEntity.type === 'button' && commandName === 'press') {
        commandName = 'on';
      }

      // Climate Mode: mode -> payload (e.g., off, heat, cool)
      if (targetEntity.type === 'climate' && commandName === 'mode') {
        commandName = String(commandValue).toLowerCase();
      }

      // Fan Percentage -> speed
      if (targetEntity.type === 'fan' && commandName === 'percentage') {
        commandName = 'speed';
      }

      // If commandName is still empty (generic set with value), deduce from entity type
      if (!commandName) {
        if (targetEntity.type === 'number') commandName = 'number';
        else if (targetEntity.type === 'select') commandName = 'option';
        else if (targetEntity.type === 'text') commandName = 'text';
        else if (targetEntity.type === 'fan' && typeof commandValue === 'number')
          commandName = 'speed'; // Changed to speed
        else {
          logger.warn(
            { entityId, payload },
            `[mqtt-subscriber] Could not deduce command name for generic set topic`,
          );
          return;
        }
      }

      const commandPacket = this.packetProcessor.constructCommandPacket(
        targetEntity,
        commandName,
        commandValue,
      );

      if (commandPacket) {
        const hexPacket = Buffer.from(commandPacket).toString('hex');
        eventBus.emit('command-packet', {
          entity: targetEntity.name || targetEntity.id,
          command: commandName,
          value: commandValue,
          packet: hexPacket,
          timestamp: new Date().toISOString(),
        });
        try {
          await this.commandManager.send(targetEntity, commandPacket);
        } catch (error) {
          logger.error(
            { err: error, entity: targetEntity.name },
            `[mqtt-subscriber] Command failed`,
          );
        }
      } else {
        logger.warn(
          { entity: targetEntity.name, command: commandName },
          `[mqtt-subscriber] Failed to construct command packet`,
        );
      }
    } else {
      logger.warn({ entityId }, `[mqtt-subscriber] Entity with ID not found`);
    }
  }
}
