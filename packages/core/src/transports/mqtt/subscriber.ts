// packages/core/src/transports/mqtt/subscriber.ts
import { MqttClient } from './mqtt.client.js';
import { HomenetBridgeConfig } from '../../config/types.js';
import { EntityConfig } from '../../domain/entities/base.entity.js';
import { logger } from '../../utils/logger.js';
import { PacketProcessor } from '../../protocol/packet-processor.js';
import { eventBus } from '../../service/event-bus.js';
import { CommandManager } from '../../service/command.manager.js';
import { ENTITY_TYPE_KEYS, findEntityById } from '../../utils/entities.js';
import { AutomationManager } from '../../automation/automation-manager.js';

export class MqttSubscriber {
  private mqttClient: MqttClient;
  private config: HomenetBridgeConfig;
  private packetProcessor: PacketProcessor;
  private commandManager: CommandManager;
  private automationManager: AutomationManager;
  private externalHandlers: Map<string, (message: Buffer) => void> = new Map();
  private portId: string;
  private topicPrefix: string;

  constructor(
    mqttClient: MqttClient,
    portId: string,
    config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    commandManager: CommandManager,
    topicPrefix: string,
    automationManager: AutomationManager,
  ) {
    this.mqttClient = mqttClient;
    this.portId = portId;
    this.config = config;
    this.packetProcessor = packetProcessor;
    this.commandManager = commandManager;
    this.topicPrefix = topicPrefix;
    this.automationManager = automationManager;

    this.mqttClient.client.on('message', (topic, message) =>
      this.handleMqttMessage(topic, message),
    );
  }

  public setupSubscriptions(): void {
    for (const entityType of ENTITY_TYPE_KEYS) {
      const entities = this.config[entityType as keyof HomenetBridgeConfig] as
        | EntityConfig[]
        | undefined;
      if (entities) {
        entities.forEach((entity) => {
          const baseTopic = `${this.topicPrefix}/${entity.id}`;
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
    const normalizedPrefix = `${this.topicPrefix}/`;

    // Only emit to service if topic starts with configured MQTT topic prefix
    if (topic.startsWith(normalizedPrefix)) {
      eventBus.emit('mqtt-message', { topic, payload: message.toString(), portId: this.portId });
    }

    if (this.externalHandlers.has(topic)) {
      this.externalHandlers.get(topic)!(message);
      return;
    }

    if (!topic.startsWith(normalizedPrefix)) {
      return;
    }

    const parts = topic.slice(normalizedPrefix.length).split('/');

    // Validate topic format: {prefix}/{entityId}/.../set
    if (parts.length < 2 || parts[parts.length - 1] !== 'set') {
      // Silently ignore known system topics (state, availability, etc.)
      const lastPart = parts[parts.length - 1];
      // Only warn if it's not a known system topic
      if (!['state', 'availability', 'attributes', 'status'].includes(lastPart)) {
        logger.warn({ topic }, `[mqtt-subscriber] Unhandled MQTT topic format`);
      }
      return;
    }

    const entityId = parts[0];
    let commandName = '';
    const payload = message.toString();
    let commandValue: number | string | undefined = undefined;

    // Case 1: homenet/{entityId}/set (General command)
    if (parts.length === 2) {
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
    // Case 2: homenet/{entityId}/{attribute}/set (Specific attribute command)
    else if (parts.length === 3) {
      commandName = parts[1]; // e.g. temperature, mode, percentage, brightness, color_temp

      // Parse value
      const num = parseFloat(payload);
      if (!isNaN(num)) {
        commandValue = num;
      } else {
        commandValue = payload;
      }
    }

    const targetEntity = findEntityById(this.config, entityId);

    if (targetEntity) {
      // Refine commandName based on entity type and payload

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

      const packetOrScript = this.packetProcessor.constructCommandPacket(
        targetEntity,
        commandName,
        commandValue,
      );

      if (packetOrScript) {
        if (!Array.isArray(packetOrScript) && 'type' in packetOrScript && packetOrScript.type === 'script') {
           logger.info({ entityId, scriptId: packetOrScript.id }, '[mqtt-subscriber] Triggering script from MQTT command');
           this.automationManager.runScript(packetOrScript.id).catch((err) => {
             logger.error({ err, scriptId: packetOrScript.id }, '[mqtt-subscriber] Failed to run script');
           });
           return;
        }

        const commandPacket = packetOrScript as number[];

        // If empty packet (virtual switch/optimistic only), we skip sending but consider it success
        if (commandPacket.length === 0) {
          logger.debug(
            { entity: targetEntity.name, command: commandName },
            `[mqtt-subscriber] Virtual/Optimistic command processed (no packet sent)`,
          );
          return;
        }

        const hexPacket = Buffer.from(commandPacket).toString('hex');
        eventBus.emit('command-packet', {
          entity: targetEntity.name || targetEntity.id,
          entityId: targetEntity.id,
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
