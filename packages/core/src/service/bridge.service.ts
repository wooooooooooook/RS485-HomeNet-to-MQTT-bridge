// packages/core/src/service/bridge.service.ts

import { Duplex } from 'stream';
import mqtt from 'mqtt';
import { performance } from 'node:perf_hooks';

import { logger } from '../utils/logger.js';
import { HomenetBridgeConfig, SerialConfig, AutomationConfig } from '../config/types.js';
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

export interface LatencyStats {
  avg: number;
  stdDev: number;
  min: number;
  max: number;
  samples: number;
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
      this.detachRawListener(context);
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

  async runLatencyTest(portId: string): Promise<LatencyStats> {
    const context = this.portContexts.get(portId);
    if (!context || !this.config) throw new Error('Port not found or config not loaded');

    // 1. Pick a random entity that has commands
    const entities: EntityConfig[] = [];
    for (const type of ENTITY_TYPE_KEYS) {
      const typeEntities = this.config[type] as EntityConfig[] | undefined;
      if (typeEntities) entities.push(...typeEntities);
    }

    const candidates = entities.filter(e =>
      Object.keys(e).some(k => k.startsWith('command_'))
    );

    if (candidates.length === 0) throw new Error('No capable entities found for test');
    const targetEntity = candidates[Math.floor(Math.random() * candidates.length)];

    // 2. Find a command to use
    const commandKey = Object.keys(targetEntity).find(k => k.startsWith('command_'));
    if (!commandKey) throw new Error('Entity has no command'); // Should not happen due to filter
    const commandName = commandKey.replace('command_', '');

    // 3. Construct the test packet (use it as input trigger)
    const testPacket = context.packetProcessor.constructCommandPacket(targetEntity, commandName);
    if (!testPacket) throw new Error(`Failed to construct test packet for ${targetEntity.id}`);

    // 4. Setup Automation
    const automationId = `latency_test_${Date.now()}`;
    const automationConfig: AutomationConfig = {
      id: automationId,
      trigger: [{
        type: 'packet',
        match: {
          data: testPacket,
          mask: testPacket.map(() => 0xFF) // Exact match
        }
      }],
      then: [{
        action: 'command',
        target: `id(${targetEntity.id}).command_${commandName}()`
      }]
    };

    context.automationManager.addAutomation(automationConfig);

    // 5. Mock CommandManager
    const originalSend = context.commandManager.send;
    // We need to bypass the `send` method entirely to avoid queueing logic if we want to measure pure processing time?
    // Actually, `processQueue` is part of the system latency. We should keep it.
    // However, `CommandManager` waits for ACK. We must prevent that.
    // We will spy on `send` but we need to resolve the promise immediately to simulate "sent".
    // Wait, `send` pushes to queue. `processQueue` calls `executeJob`. `executeJob` calls `port.write` and waits.
    // We want to measure time until `CommandManager.send` is CALLED by the automation action?
    // No, `AutomationManager` calls `commandManager.send`.
    // So if we mock `send`, we measure time until automation finishes.
    // That's "Packet Reception -> Command Generation".

    const measurements: number[] = [];
    let resolveTestIteration: (() => void) | null = null;

    // Replace send with our measurement hook
    context.commandManager.send = async (_entity, _packet) => {
      if (resolveTestIteration) resolveTestIteration();
      return Promise.resolve();
    };

    try {
      // 6. Loop
      for (let i = 0; i < 100; i++) {
        // Wait a bit to ensure clean state?
        await new Promise(r => setTimeout(r, 2));

        const start = performance.now();
        const iterationPromise = new Promise<void>(resolve => { resolveTestIteration = resolve; });

        // Inject
        // We must mimic serial data coming in.
        context.stateManager.processIncomingData(Buffer.from(testPacket));

        // Wait for command generation
        // Timeout safety
        const timeoutPromise = new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000));

        await Promise.race([iterationPromise, timeoutPromise]);

        const end = performance.now();
        measurements.push(end - start);
      }
    } finally {
      // Cleanup
      context.commandManager.send = originalSend;
      context.automationManager.removeAutomation(automationId);
    }

    // 7. Calculate Stats
    if (measurements.length === 0) return { avg: 0, stdDev: 0, min: 0, max: 0, samples: 0 };

    const sum = measurements.reduce((a, b) => a + b, 0);
    const avg = sum / measurements.length;
    const variance = measurements.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / measurements.length;
    const stdDev = Math.sqrt(variance);

    return {
      avg: Math.round(avg * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      min: Math.round(Math.min(...measurements) * 100) / 100,
      max: Math.round(Math.max(...measurements) * 100) / 100,
      samples: measurements.length
    };
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

  // Keep track of how many consumers need raw data
  private rawListenerRefCounts = new Map<string, number>();

  private attachRawListener(context: PortContext): void {
    const currentCount = this.rawListenerRefCounts.get(context.portId) || 0;
    this.rawListenerRefCounts.set(context.portId, currentCount + 1);

    if (context.rawPacketListener) {
      // Already attached, just incremented ref count
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

  private detachRawListener(context: PortContext): void {
    const currentCount = this.rawListenerRefCounts.get(context.portId) || 0;
    if (currentCount <= 0) return;

    const newCount = currentCount - 1;
    this.rawListenerRefCounts.set(context.portId, newCount);

    if (newCount === 0 && context.rawPacketListener) {
      logger.info({ portId: context.portId }, '[core] Stopping raw packet listener.');
      context.port.off('data', context.rawPacketListener);
      context.rawPacketListener = null;
      context.packetIntervals = [];
      context.lastPacketTimestamp = null;
    }
  }

  private analyzeAndEmitPacketStats(context: PortContext) {
    const intervals = [...context.packetIntervals];
    // Do not clear the buffer; it's a rolling window managed in attachRawListener

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

    const idleOccurrenceIntervals: number[] = [];
    if (idleIndices.length >= 2) {
      for (let i = 0; i < idleIndices.length - 1; i++) {
        const startIndex = idleIndices[i];
        const endIndex = idleIndices[i + 1];
        let sum = 0;
        for (let k = startIndex + 1; k <= endIndex; k++) {
          sum += intervals[k];
        }
        idleOccurrenceIntervals.push(sum);
      }
    }
    const idleOccurrenceStats = calculateStats(idleOccurrenceIntervals);

    const round = (num: number) => Math.round(num * 100) / 100;

    eventBus.emit('packet-interval-stats', {
      portId: context.portId,
      packetAvg: round(packetStats.avg),
      packetStdDev: round(packetStats.stdDev),
      idleAvg: round(idleStats.avg),
      idleStdDev: round(idleStats.stdDev),
      idleOccurrenceAvg: round(idleOccurrenceStats.avg),
      idleOccurrenceStdDev: round(idleOccurrenceStats.stdDev),
      sampleSize: intervals.length,
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
