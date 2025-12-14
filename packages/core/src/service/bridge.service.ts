// packages/core/src/service/bridge.service.ts

import { Duplex } from 'stream';
import mqtt from 'mqtt';

import { logger } from '../utils/logger.js';
import { HomenetBridgeConfig, SerialConfig } from '../config/types.js';
import { loadConfig } from '../config/index.js';
import { EntityConfig } from '../domain/entities/base.entity.js';
import { PacketProcessor, EntityStateProvider } from '../protocol/packet-processor.js';
import { createSerialPortConnection } from '../transports/serial/serial.factory.js';
import { MqttClient } from '../transports/mqtt/mqtt.client.js';
import { MqttSubscriber } from '../transports/mqtt/subscriber.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { StateManager } from '../state/state-manager.js';
import { eventBus } from './event-bus.js';
import { CommandManager } from './command.manager.js';
import { clearStateCache } from '../state/store.js';
import { DiscoveryManager } from '../mqtt/discovery-manager.js';
import { ENTITY_TYPE_KEYS, findEntityById } from '../utils/entities.js';
import { AutomationManager } from '../automation/automation-manager.js';
import { MQTT_TOPIC_PREFIX } from '../utils/constants.js';
import { normalizePortId } from '../utils/port.js';

interface PortContext {
  portId: string;
  serialConfig: SerialConfig;
  serialPath: string;
  port: Duplex;
  packetProcessor: PacketProcessor;
  mqttSubscriber: MqttSubscriber;
  mqttPublisher: MqttPublisher;
  stateManager: StateManager;
  commandManager: CommandManager;
  discoveryManager: DiscoveryManager;
  automationManager: AutomationManager;
  rawPacketListener: ((data: Buffer) => void) | null;
  lastPacketTimestamp: number | null;
  packetIntervals: number[];
}

export type SerialFactory = (serialPath: string, serialConfig: SerialConfig) => Promise<Duplex>;

// Redefine BridgeOptions to use the new HomenetBridgeConfig
export interface BridgeOptions {
  configPath: string; // Path to the homenet_bridge.yaml configuration file
  mqttUrl: string;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttTopicPrefix?: string;
  configOverride?: HomenetBridgeConfig;
  serialFactory?: SerialFactory;
}

export class HomeNetBridge {
  private readonly minPacketIntervalsForStats = 10;
  private readonly options: BridgeOptions;
  private _mqttClient!: MqttClient; // New internal instance
  private client!: MqttClient['client']; // Reference to the actual mqtt client
  private startPromise: Promise<void> | null = null;

  private config?: HomenetBridgeConfig; // Loaded configuration
  private readonly portContexts = new Map<string, PortContext>();
  private hrtimeBase: bigint = process.hrtime.bigint(); // Base time for monotonic clock
  private resolvedPortTopicPrefixes = new Map<string, string>();
  private commonMqttTopicPrefix = MQTT_TOPIC_PREFIX;

  constructor(options: BridgeOptions) {
    this.options = options;
  }

  async start() {
    if (!this.startPromise) {
      this.startPromise = this.initialize();
    }
    return this.startPromise;
  }

  async stop() {
    if (this.startPromise) {
      await this.startPromise.catch(() => { });
    }

    for (const context of this.portContexts.values()) {
      context.automationManager.stop();
      if (context.rawPacketListener) {
        context.port.off('data', context.rawPacketListener);
      }
      context.port.removeAllListeners();
      context.port.destroy();
    }
    this.portContexts.clear();

    this._mqttClient.end();
    this.startPromise = null;
  }

  /**
   * Send a raw packet directly to the serial port without ACK waiting
   */
  sendRawPacket(portId: string, packet: number[]): boolean {
    const context = this.portContexts.get(portId) || this.getDefaultContext();
    if (!context) {
      logger.warn('[core] Cannot send packet: serial port not initialized');
      return false;
    }
    context.port.write(Buffer.from(packet));
    logger.info({
      portId: context.portId,
      packet: packet.map((b) => b.toString(16).padStart(2, '0')).join(' '),
    }, '[core] Raw packet sent');
    return true;
  }

  /**
   * Get the loaded configuration
   */
  getConfig(): HomenetBridgeConfig | undefined {
    return this.config;
  }

  renameEntity(entityId: string, newName: string, uniqueId?: string): { success: boolean; error?: string } {
    if (!this.config) {
      return { success: false, error: 'Bridge not initialized' };
    }

    const entityEntry = this.findEntityConfig(entityId);

    if (!entityEntry) {
      logger.warn({ entityId }, '[core] Rename requested for unknown entity');
      return { success: false, error: 'Entity not found' };
    }

    const { entity } = entityEntry;
    const trimmedName = newName.trim();
    if (!trimmedName) {
      return { success: false, error: 'New name must not be empty' };
    }
    const ensuredUniqueId = uniqueId || entity.unique_id || `homenet_${entity.id}`;

    entity.name = trimmedName;
    if (!entity.unique_id) {
      entity.unique_id = ensuredUniqueId;
    }

    eventBus.emit('entity:renamed', { entityId, newName: trimmedName, uniqueId: ensuredUniqueId });
    return { success: true };
  }

  startRawPacketListener(portId?: string): void {
    const targets = portId ? [this.portContexts.get(portId)].filter(Boolean) as PortContext[] : [...this.portContexts.values()];
    targets.forEach((context) => this.attachRawListener(context));
  }

  stopRawPacketListener(portId?: string): void {
    const targets = portId ? [this.portContexts.get(portId)].filter(Boolean) as PortContext[] : [...this.portContexts.values()];
    targets.forEach((context) => {
      if (context.rawPacketListener) {
      logger.info({ portId: context.portId }, '[core] Stopping raw packet listener.');
        context.port.off('data', context.rawPacketListener);
        context.rawPacketListener = null;
        context.packetIntervals = [];
        context.lastPacketTimestamp = null;
      }
    });
  }

  async executeCommand(
    entityId: string,
    commandName: string,
    value?: number | string,
    portId?: string,
  ): Promise<{ success: boolean; packet?: string; error?: string }> {
    const context = this.getDefaultContext(portId);
    if (!this.config || !context) {
      return { success: false, error: 'Bridge not initialized' };
    }

    // Find entity in config (same logic as subscriber)
    const targetEntity = findEntityById(this.config, entityId);

    if (!targetEntity) {
      return { success: false, error: `Entity ${entityId} not found` };
    }

    // Construct command packet using packetProcessor (same as subscriber)
    const commandPacket = context.packetProcessor.constructCommandPacket(
      targetEntity,
      commandName,
      value,
    );

    if (!commandPacket) {
      return { success: false, error: `Failed to construct packet for ${commandName}` };
    }

    const hexPacket = Buffer.from(commandPacket).toString('hex');

    // Emit command-packet event (same as subscriber)
    eventBus.emit('command-packet', {
      entity: targetEntity.name || targetEntity.id,
      entityId: targetEntity.id,
      command: commandName,
      value: value,
      packet: hexPacket,
      portId: context.portId,
      timestamp: new Date().toISOString(),
    });

    // Send command via commandManager (same as subscriber)
    try {
      await context.commandManager.send(targetEntity, commandPacket);
      return { success: true, packet: hexPacket };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, packet: hexPacket, error: message };
    }
  }

  private buildStateProvider(portId: string): EntityStateProvider {
    return {
      getLightState: (entityId: string) => this.portContexts.get(portId)?.stateManager.getLightState(entityId),
      getClimateState: (entityId: string) => this.portContexts.get(portId)?.stateManager.getClimateState(entityId),
    };
  }

  private resolvePortTopicPrefix(serialConfig: SerialConfig, index: number): string {
    return normalizePortId(serialConfig.portId, index);
  }

  private getDefaultContext(portId?: string): PortContext | undefined {
    if (portId) {
      return this.portContexts.get(portId);
    }
    const first = this.portContexts.values().next();
    return first.done ? undefined : first.value;
  }

  private resolveSerialPath(serialConfig: SerialConfig): string {
    if (!serialConfig.path || !serialConfig.path.trim()) {
      throw new Error(`[core] serial(${serialConfig.portId})에 유효한 path가 필요합니다.`);
    }

    return serialConfig.path.trim();
  }

  private getMqttTopicPrefix(portId: string): string {
    const portPrefix = this.resolvedPortTopicPrefixes.get(portId);
    const fallbackPortPrefix = this.resolvedPortTopicPrefixes.values().next().value || 'homedevice1';
    const effectivePortPrefix = (portPrefix || fallbackPortPrefix).toString().trim();

    return `${this.commonMqttTopicPrefix}/${effectivePortPrefix}`;
  }

  private async initialize() {
    this.resolvedPortTopicPrefixes.clear();

    this.config = this.options.configOverride ?? await loadConfig(this.options.configPath);
    clearStateCache();
    this.commonMqttTopicPrefix = (this.options.mqttTopicPrefix || MQTT_TOPIC_PREFIX).trim();
    logger.info('[core] MQTT 연결을 백그라운드에서 대기하며 시리얼 포트 연결을 진행합니다.');

    this.config.serials.forEach((serial, index) => {
      const normalizedPortId = normalizePortId(serial.portId, index);
      const portPrefix = this.resolvePortTopicPrefix(serial, index);
      this.resolvedPortTopicPrefixes.set(normalizedPortId, portPrefix);
    });

    const defaultWillPortId = normalizePortId(this.config.serials[0]?.portId, 0);
    const mqttOptions: mqtt.IClientOptions = {
      will: {
        topic: `${this.getMqttTopicPrefix(defaultWillPortId)}/bridge/status`,
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    };

    if (this.options.mqttUsername) {
      mqttOptions.username = this.options.mqttUsername;
    }
    if (this.options.mqttPassword) {
      mqttOptions.password = this.options.mqttPassword;
    }

    this._mqttClient = new MqttClient(this.options.mqttUrl, mqttOptions);
    this.client = this._mqttClient.client; // Assign the client from the new MqttClient instance

    for (let index = 0; index < this.config.serials.length; index += 1) {
      const serialConfig = this.config.serials[index];
      const normalizedPortId = normalizePortId(serialConfig.portId, index);
      const serialPath = this.resolveSerialPath(serialConfig);

      const factory = this.options.serialFactory || createSerialPortConnection;
      const port = await factory(serialPath, serialConfig);

      const stateProvider = this.buildStateProvider(normalizedPortId);
      const packetProcessor = new PacketProcessor(this.config, stateProvider);
      logger.debug({ portId: normalizedPortId }, '[core] PacketProcessor initialized.');

      packetProcessor.on('parsed-packet', (data) => {
        const { deviceId, packet, state } = data;
        const hexPacket = packet.map((b: number) => b.toString(16).padStart(2, '0')).join('');
        eventBus.emit('parsed-packet', {
          portId: normalizedPortId,
          entityId: deviceId,
          packet: hexPacket,
          state,
          timestamp: new Date().toISOString(),
        });
      });

      const mqttTopicPrefix = this.getMqttTopicPrefix(normalizedPortId);
      const mqttPublisher = new MqttPublisher(this._mqttClient, mqttTopicPrefix);
      const stateManager = new StateManager(
        normalizedPortId,
        this.config,
        packetProcessor,
        mqttPublisher,
        mqttTopicPrefix,
      );
      const commandManager = new CommandManager(port, this.config, normalizedPortId);
      const mqttSubscriber = new MqttSubscriber(
        this._mqttClient,
        normalizedPortId,
        this.config,
        packetProcessor,
        commandManager,
        mqttTopicPrefix,
      );

      // Set up subscriptions
      if (this._mqttClient.isConnected) {
        mqttSubscriber.setupSubscriptions();
      } else {
        this.client.on('connect', () => mqttSubscriber.setupSubscriptions());
      }

      // Initialize DiscoveryManager
      const discoveryManager = new DiscoveryManager(
        normalizedPortId,
        this.config,
        mqttPublisher,
        mqttSubscriber,
        mqttTopicPrefix,
      );
      discoveryManager.setup();

      if (this._mqttClient.isConnected) {
        discoveryManager.discover();
      } else {
        this.client.on('connect', () => discoveryManager.discover());
      }

      const automationManager = new AutomationManager(
        this.config,
        packetProcessor,
        commandManager,
        mqttPublisher,
      );
      automationManager.start();

      const context: PortContext = {
        portId: normalizedPortId,
        serialConfig,
        serialPath,
        port,
        packetProcessor,
        mqttSubscriber,
        mqttPublisher,
        stateManager,
        commandManager,
        discoveryManager,
        automationManager,
        rawPacketListener: null,
        lastPacketTimestamp: null,
        packetIntervals: [],
      };

      port.on('data', (data) => {
        if (!context.rawPacketListener) {
          context.stateManager.processIncomingData(data);
        }
      });

      port.on('error', (err) => {
        logger.error({ err, serialPath, portId: normalizedPortId }, '[core] 시리얼 포트 오류');
      });

      this.portContexts.set(normalizedPortId, context);
    }
  }

  private attachRawListener(context: PortContext): void {
    if (context.rawPacketListener) {
      return;
    }

    logger.info({ portId: context.portId }, '[core] Starting raw packet listener.');

    context.rawPacketListener = (data: Buffer) => {
      const hrNow = process.hrtime.bigint();
      const now = Number((hrNow - this.hrtimeBase) / 1000000n); // Convert to ms

      let interval: number | null = null;

      if (context.lastPacketTimestamp !== null) {
        interval = now - context.lastPacketTimestamp;
        context.packetIntervals.push(interval);
        if (context.packetIntervals.length > 1000) {
          context.packetIntervals.shift();
        }
      }

      context.lastPacketTimestamp = now;

      const hexData = data.toString('hex');
      eventBus.emit('raw-data-with-interval', {
        portId: context.portId,
        payload: hexData,
        interval,
        receivedAt: new Date().toISOString(),
      });

      if (context.packetIntervals.length >= this.minPacketIntervalsForStats) {
        this.analyzeAndEmitPacketStats(context);
      }

      context.stateManager.processIncomingData(data);
    };

    context.port.on('data', context.rawPacketListener);
  }

  private analyzeAndEmitPacketStats(context: PortContext) {
    const intervals = [...context.packetIntervals];
    context.packetIntervals = [];

    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(
      intervals.map((x) => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / intervals.length,
    );

    const threshold = mean + 1.5 * stdDev;
    const packetIntervals: number[] = [];
    const idleIntervals: number[] = [];
    const idleIndices: number[] = [];

    for (let i = 0; i < intervals.length; i++) {
      const interval = intervals[i];
      if (interval > threshold) {
        idleIntervals.push(interval);
        idleIndices.push(i);
      } else {
        packetIntervals.push(interval);
      }
    }

    const calculateStats = (data: number[]) => {
      if (data.length === 0) return { avg: 0, stdDev: 0 };
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const std = Math.sqrt(
        data.map((x) => Math.pow(x - avg, 2)).reduce((a, b) => a + b, 0) / data.length,
      );
      return { avg, stdDev: std };
    };

    const packetStats = calculateStats(packetIntervals);
    const idleStats = calculateStats(idleIntervals);

    eventBus.emit('packet-interval-stats', {
      portId: context.portId,
      stats: {
        packet: packetStats,
        idle: idleStats,
        idleIndices,
      },
    });
  }

  private findEntityConfig(
    entityId: string,
  ): { type: keyof HomenetBridgeConfig; entity: EntityConfig } | undefined {
    for (const type of ENTITY_TYPE_KEYS) {
      const entities = this.config?.[type];
      if (!entities) continue;

      const entity = (entities as EntityConfig[]).find((e) => e.id === entityId);
      if (entity) {
        return { type, entity };
      }
    }
    return undefined;
  }
}
