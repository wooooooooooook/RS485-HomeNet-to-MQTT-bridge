// packages/core/src/transports/mqtt/subscriber.ts
import { MqttClient } from './mqtt.client.js';
import { HomenetBridgeConfig } from '../../config/types.js';
import { EntityConfig, CommandSchema } from '../../domain/entities/base.entity.js';
import { logger } from '../../utils/logger.js';
import { PacketProcessor, EntityStateProvider } from '../../protocol/packet-processor.js';
import { eventBus } from '../../service/event-bus.js';
import { CommandManager } from '../../service/command.manager.js';
import { ENTITY_TYPE_KEYS, findEntityById } from '../../utils/entities.js';
import { AutomationManager } from '../../automation/automation-manager.js';
import { StateSchema } from '../../protocol/types.js';

export class MqttSubscriber {
  private mqttClient: MqttClient;
  private config: HomenetBridgeConfig;
  private packetProcessor: PacketProcessor;
  private commandManager: CommandManager;
  private automationManager?: AutomationManager;
  private stateProvider?: EntityStateProvider;
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
    automationManager?: AutomationManager,
    stateProvider?: EntityStateProvider,
  ) {
    this.mqttClient = mqttClient;
    this.portId = portId;
    this.config = config;
    this.packetProcessor = packetProcessor;
    this.commandManager = commandManager;
    this.topicPrefix = topicPrefix;
    this.automationManager = automationManager;
    this.stateProvider = stateProvider;

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

  private normalizeCommandName(commandName: string) {
    return commandName.startsWith('command_') ? commandName : `command_${commandName}`;
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

      // Climate Fan Mode: prefer standard fan_* commands if present, fallback to custom_fan
      if (targetEntity.type === 'climate' && commandName === 'fan_mode') {
        const fanModeValue = String(commandValue);
        const normalizedFanMode = fanModeValue.toLowerCase();
        const fanCommandKey = `command_fan_${normalizedFanMode}`;

        if (fanCommandKey in (targetEntity as any)) {
          commandName = `fan_${normalizedFanMode}`;
          commandValue = undefined;
        } else if (
          (targetEntity as any).command_custom_fan ||
          (targetEntity as any).custom_fan_mode
        ) {
          commandName = 'custom_fan';
          commandValue = fanModeValue;
        } else {
          commandName = `fan_${normalizedFanMode}`;
          commandValue = undefined;
        }
      }

      // Climate Preset Mode: prefer standard preset_* commands if present, fallback to custom_preset
      if (targetEntity.type === 'climate' && commandName === 'preset_mode') {
        const presetValue = String(commandValue);
        const normalizedPreset = presetValue.toLowerCase();
        const presetCommandKey = `command_preset_${normalizedPreset}`;

        if (presetCommandKey in (targetEntity as any)) {
          commandName = `preset_${normalizedPreset}`;
          commandValue = undefined;
        } else if (
          (targetEntity as any).command_custom_preset ||
          (targetEntity as any).custom_preset
        ) {
          commandName = 'custom_preset';
          commandValue = presetValue;
        } else {
          commandName = `preset_${normalizedPreset}`;
          commandValue = undefined;
        }
      }

      // Fan Percentage -> speed
      if (targetEntity.type === 'fan' && commandName === 'percentage') {
        commandName = 'speed';
      }

      // Fan Preset Mode: keep as preset_mode (unified with CEL support)
      // The command value (xstr) is passed as-is to command_preset_mode CEL expression

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

      const commandKey = this.normalizeCommandName(commandName);
      const commandSchema = (targetEntity as any)[commandKey];

      if (commandSchema && typeof commandSchema === 'object' && (commandSchema as any).script) {
        if (this.automationManager) {
          // Include entity state in context for CEL script access
          const entityState = this.stateProvider?.getEntityState(entityId) || {};

          // Evaluate args from commandSchema (same as executeCommandAction in automation-manager)
          const schemaArgs = (commandSchema as any).args || {};
          const evaluatedArgs: Record<string, any> = {};

          // Build context with 'x' for command value (injection)
          // x is the value from MQTT payload (e.g., percentage for fan speed)
          const triggerContext = {
            type: 'command' as const,
            timestamp: Date.now(),
            state: entityState,
          };

          for (const [key, value] of Object.entries(schemaArgs)) {
            if (typeof value === 'string') {
              // Heuristic to check if value needs CEL evaluation
              if (
                value.includes('(') ||
                value.includes('.') ||
                value.includes('[') ||
                /\bx\b/.test(value)
              ) {
                try {
                  // Use automationManager's executeWithContext to evaluate CEL with 'x' variable
                  const result = this.automationManager.evaluateCELWithValue(
                    value,
                    triggerContext,
                    commandValue,
                  );
                  evaluatedArgs[key] = result !== undefined ? result : value;
                } catch (e) {
                  evaluatedArgs[key] = value;
                }
              } else {
                evaluatedArgs[key] = value;
              }
            } else {
              evaluatedArgs[key] = value;
            }
          }

          await this.automationManager.runScript(
            (commandSchema as any).script,
            triggerContext,
            evaluatedArgs,
          );
        } else {
          logger.warn(
            { entityId, command: commandKey },
            '[mqtt-subscriber] automationManager가 없어 script 실행을 건너뜁니다.',
          );
        }
        return;
      }

      const commandResult = this.packetProcessor.constructCommandPacket(
        targetEntity,
        commandName,
        commandValue,
      );

      if (commandResult) {
        // Extract packet and ack from result (can be number[] or CommandResult)
        let commandPacket: number[];
        let celAck: StateSchema | undefined;

        if (Array.isArray(commandResult)) {
          commandPacket = commandResult;
        } else {
          // CommandResult with { packet, ack }
          commandPacket = commandResult.packet;
          celAck = commandResult.ack;
        }

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
          // Determine ackMatch: CEL result ack takes priority, then commandSchema ack
          let ackMatch: StateSchema | undefined = celAck;
          if (!ackMatch && commandSchema && typeof commandSchema === 'object') {
            const schema = commandSchema as CommandSchema;
            if (schema.ack) {
              ackMatch = Array.isArray(schema.ack) ? { data: schema.ack } : schema.ack;
            }
          }

          await this.commandManager.send(targetEntity, commandPacket, { ackMatch });
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
