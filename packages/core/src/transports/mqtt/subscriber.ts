// packages/core/src/transports/mqtt/subscriber.ts
import { MqttClient } from './mqtt.client.js';
import { HomenetBridgeConfig } from '../../config/types.js';
import { EntityConfig } from '../../domain/entities/base.entity.js';
import { logger } from '../../utils/logger.js';
import { PacketProcessor } from '../../protocol/packet-processor.js';
import { Duplex } from 'stream'; // For this.port.write

export class MqttSubscriber {
  private mqttClient: MqttClient;
  private config: HomenetBridgeConfig;
  private packetProcessor: PacketProcessor;
  private serialPort: Duplex;
  private externalHandlers: Map<string, (message: Buffer) => void> = new Map();

  constructor(
    mqttClient: MqttClient,
    config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    serialPort: Duplex,
  ) {
    this.mqttClient = mqttClient;
    this.config = config;
    this.packetProcessor = packetProcessor;
    this.serialPort = serialPort;

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
          const baseTopic = `homenet/${entity.id}`;
          this.mqttClient.client.subscribe(`${baseTopic}/set/#`, (err) => {
            if (err)
              logger.error({ err, topic: `${baseTopic}/set/#` }, `[mqtt-subscriber] Failed to subscribe`);
            else logger.info(`[mqtt-subscriber] Subscribed to ${baseTopic}/set/#`);
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

  private handleMqttMessage(topic: string, message: Buffer) {
    if (!this.config || !this.packetProcessor || !this.serialPort) {
      logger.error('[mqtt-subscriber] Configuration, PacketProcessor or Serial Port not initialized.');
      return;
    }

    logger.debug({ topic, message: message.toString() }, '[mqtt-subscriber] MQTT 메시지 수신');

    if (this.externalHandlers.has(topic)) {
      this.externalHandlers.get(topic)!(message);
      return;
    }

    const parts = topic.split('/');
    if (parts.length < 4 || parts[0] !== 'homenet' || parts[2] !== 'set') {
      logger.warn({ topic }, `[mqtt-subscriber] Unhandled MQTT topic format`);
      return;
    }

    const entityId = parts[1];
    const commandName = `command_${parts[3]}`;

    const payload = message.toString();
    let commandValue: number | string | undefined = undefined;

    if (['command_temperature', 'command_speed'].includes(commandName)) {
      const num = parseFloat(payload);
      if (!isNaN(num)) {
        commandValue = num;
      } else {
        commandValue = payload;
      }
    } else {
      commandValue = payload;
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
    ];
    const targetEntity = entityTypes
      .map((type) => this.config![type] as EntityConfig[] | undefined)
      .filter((entities): entities is EntityConfig[] => !!entities)
      .flat()
      .find((e) => e.id === entityId);

    if (targetEntity) {
      const commandPacket = this.packetProcessor.constructCommandPacket(
        targetEntity,
        commandName,
        commandValue,
      );
      if (commandPacket) {
        logger.info(
          {
            entity: targetEntity.name,
            command: commandName,
            packet: Buffer.from(commandPacket).toString('hex'),
          },
          `[mqtt-subscriber] Sending command packet`,
        );
        this.serialPort.write(Buffer.from(commandPacket));
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
