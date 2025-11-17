// packages/core/src/index.ts

import { Duplex } from 'stream';
import net from 'net';
import dotenv from 'dotenv';
import { SerialPort } from 'serialport';
import mqtt from 'mqtt';
import { access, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import yaml, { Type, Schema } from 'js-yaml'; // Import js-yaml, Type, and Schema

// Define a custom YAML type for !homenet_logic
const HOMENET_LOGIC_TYPE = new Type('!homenet_logic', {
  kind: 'mapping', // It's a mapping (object), not a scalar
  construct: function (data) {
    // data will be the parsed object under !homenet_logic
    // We can directly return it as it should conform to CommandLambdaConfig or StateLambdaConfig
    return data;
  }
});

// Create a schema that includes the custom HOMENET_LOGIC_TYPE
const HOMENET_BRIDGE_SCHEMA = yaml.DEFAULT_SCHEMA.extend([HOMENET_LOGIC_TYPE]);

// Import new configuration interfaces and PacketProcessor
import { logger } from './logger.js';
import { handleData, stateCache } from './dataHandler.js'; // Import stateCache
import {
  HomenetBridgeConfig,
  EntityConfig,
  LightEntity,
  ClimateEntity,
  ValveEntity,
  ButtonEntity,
  SensorEntity,
  FanEntity,
  SwitchEntity,
  BinarySensorEntity,
  CommandSchema,
} from './config.js';
import { PacketProcessor, EntityStateProvider } from './packetProcessor.js';

dotenv.config();

const SERIAL_WAIT_INTERVAL_MS = 500;
const DEFAULT_SERIAL_WAIT_TIMEOUT_MS = 15000;

const isTcpConnection = (serialPath: string) => serialPath.includes(':');

const resolveSerialWaitTimeout = () => {
  const raw = process.env.SERIAL_PATH_WAIT_TIMEOUT_MS ?? '';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_SERIAL_WAIT_TIMEOUT_MS;
  }

  return parsed;
};

const SERIAL_WAIT_TIMEOUT_MS = resolveSerialWaitTimeout();

const waitForSerialDevice = async (serialPath: string) => {
  const startedAt = Date.now();

  while (true) {
    try {
      await access(serialPath);
      return;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error && error.code && error.code !== 'ENOENT' && error.code !== 'ENODEV') {
        throw error;
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= SERIAL_WAIT_TIMEOUT_MS) {
        throw new Error(
          `시리얼 포트 경로(${serialPath})를 ${SERIAL_WAIT_TIMEOUT_MS}ms 내에 찾지 못했습니다.`
        );
      }

      await delay(SERIAL_WAIT_INTERVAL_MS);
    }
  }
};

const openSerialPort = (port: SerialPort) =>
  new Promise<void>((resolve, reject) => {
    port.open((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });

// Redefine BridgeOptions to use the new HomenetBridgeConfig
export interface BridgeOptions {
  configPath: string; // Path to the homenet_bridge.yaml configuration file
  mqttUrl: string;
}

export class HomeNetBridge implements EntityStateProvider {
  private readonly options: BridgeOptions;
  private readonly client: mqtt.MqttClient;
  private port?: Duplex;
  private startPromise: Promise<void> | null = null;

  private config?: HomenetBridgeConfig; // Loaded configuration
  private packetProcessor?: PacketProcessor; // The new packet processor

  constructor(options: BridgeOptions) {
    this.options = options;
    this.client = mqtt.connect(options.mqttUrl);
  }

  // Implement EntityStateProvider methods
  getLightState(entityId: string): { isOn: boolean } | undefined {
    const topic = `homenet/${entityId}/state`;
    const state = stateCache.get(topic);
    if (state) {
      const parsedState = JSON.parse(state);
      if (typeof parsedState.isOn === 'boolean') {
        return { isOn: parsedState.isOn };
      }
    }
    return undefined;
  }

  getClimateState(entityId: string): { targetTemperature: number } | undefined {
    const topic = `homenet/${entityId}/state`;
    const state = stateCache.get(topic);
    if (state) {
      const parsedState = JSON.parse(state);
      if (typeof parsedState.targetTemperature === 'number') {
        return { targetTemperature: parsedState.targetTemperature };
      }
    }
    return undefined;
  }

  async start() {
    if (!this.startPromise) {
      this.startPromise = this.initialize();
    }
    return this.startPromise;
  }

  async stop() {
    if (this.startPromise) {
      await this.startPromise.catch(() => {});
    }
    this.client.end();
    if (this.port) {
      this.port.removeAllListeners();
      this.port.destroy();
      this.port = undefined;
    }
    this.startPromise = null;
  }

  private async initialize() {
    // 1. Load configuration
    logger.info(`[core] Loading configuration from: ${this.options.configPath}`);
    const configFileContent = await readFile(this.options.configPath, 'utf8');
    const loadedYaml = yaml.load(configFileContent, { schema: HOMENET_BRIDGE_SCHEMA });

    if (!loadedYaml || !(loadedYaml as any).homenet_bridge) {
      throw new Error('Invalid configuration file structure. Missing "homenet_bridge" top-level key.');
    }

    const loadedConfig = (loadedYaml as any).homenet_bridge as HomenetBridgeConfig;
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
    const hasEntities = entityTypes.some(
      (type) => loadedConfig[type] && Array.isArray(loadedConfig[type])
    );

    if (!hasEntities) {
      throw new Error('Configuration file must contain at least one entity (e.g., light, climate).');
    }

    this.config = loadedConfig;
    this.packetProcessor = new PacketProcessor(this.config, this); // Pass 'this' as stateProvider

    const { serial: serialConfig } = this.config;

    this.client.on('connect', () => {
      logger.info(`[core] MQTT에 연결되었습니다: ${this.options.mqttUrl}`);
      // Subscribe to command topics for all entities
      const entityTypes = [
        'light',
        'climate',
        'valve',
        'button',
        'sensor',
        'fan',
        'switch',
        'binary_sensor',
      ];
      for (const entityType of entityTypes) {
        const entities = this.config![entityType as keyof HomenetBridgeConfig] as
          | EntityConfig[]
          | undefined;
        if (entities) {
          entities.forEach((entity) => {
            const baseTopic = `homenet/${entity.id}`;
            this.client.subscribe(`${baseTopic}/set/#`, (err) => {
              // Example: homenet/light_1/set/on, homenet/climate_1/set/temperature
              if (err)
                logger.error({ err, topic: `${baseTopic}/set/#` }, `[core] Failed to subscribe`);
              else logger.info(`[core] Subscribed to ${baseTopic}/set/#`);
            });
          });
        }
      }
    });

    this.client.on('message', (topic, message) => this.handleMqttMessage(topic, message));

    this.client.on('error', (err) => {
      logger.error({ err }, '[core] MQTT 연결 오류');
    });

    // Open serial port
    const serialPath = process.env.SERIAL_PORT || '/simshare/rs485-sim-tty'; // Use environment variable for serial path, or fallback
    const baudRate = serialConfig.baud_rate; // Get baud rate from config

    logger.info({ serialPath, baudRate }, '[core] 시리얼 포트 연결 시도');

    if (isTcpConnection(serialPath)) {
      const [host, port] = serialPath.split(':');
      this.port = net.createConnection({ host, port: Number(port) });
    } else {
      await waitForSerialDevice(serialPath);
      const serialPort = new SerialPort({
        path: serialPath,
        baudRate,
        dataBits: serialConfig.data_bits,
        parity: serialConfig.parity,
        stopBits: serialConfig.stop_bits,
        autoOpen: false,
      });
      this.port = serialPort;
      await openSerialPort(serialPort);
    }

    this.port.on('data', (data) => {
      if (this.config && this.packetProcessor) {
        handleData(data, this.config, this.packetProcessor, this.client);
      }
    });
    this.port.on('error', (err) => {
      logger.error({ err, serialPath }, '[core] 시리얼 포트 오류');
    });
  }

  private handleMqttMessage(topic: string, message: Buffer) {
    if (!this.config || !this.packetProcessor || !this.port) {
      logger.error('[core] Configuration, PacketProcessor or Serial Port not initialized.');
      return;
    }

    logger.debug({ topic, message: message.toString() }, '[core] MQTT 메시지 수신');

    const parts = topic.split('/');
    if (parts.length < 4 || parts[0] !== 'homenet' || parts[2] !== 'set') {
      logger.warn({ topic }, `[core] Unhandled MQTT topic format`);
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
        commandValue
      );
      if (commandPacket) {
        logger.info(
          {
            entity: targetEntity.name,
            command: commandName,
            packet: Buffer.from(commandPacket).toString('hex'),
          },
          `[core] Sending command packet`
        );
        this.port.write(Buffer.from(commandPacket));
      } else {
        logger.warn(
          { entity: targetEntity.name, command: commandName },
          `[core] Failed to construct command packet`
        );
      }
    } else {
      logger.warn({ entityId }, `[core] Entity with ID not found`);
    }
  }
}

export async function createBridge(configPath: string, mqttUrl: string) {
  const bridge = new HomeNetBridge({ configPath, mqttUrl });
  await bridge.start(); // Ensure initialization completes before returning
  return bridge;
}
