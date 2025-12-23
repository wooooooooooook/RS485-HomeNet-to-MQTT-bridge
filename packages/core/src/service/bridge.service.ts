// packages/core/src/service/bridge.service.ts

import { Duplex } from 'stream';
import mqtt from 'mqtt';
import { performance } from 'node:perf_hooks';

import { logger } from '../utils/logger.js';
import { HomenetBridgeConfig, SerialConfig, AutomationConfig } from '../config/types.js';
import { loadConfig } from '../config/index.js';
import { EntityConfig } from '../domain/entities/base.entity.js';
import { PacketProcessor, EntityStateProvider } from '../protocol/packet-processor.js';
import {
  calculateChecksumFromBuffer,
  calculateChecksum2FromBuffer,
  ChecksumType,
  Checksum2Type,
} from '../protocol/utils/checksum.js';
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
      await this.startPromise.catch(() => {});
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
  sendRawPacket(portId: string | undefined, packet: number[]): boolean {
    const context =
      (portId ? this.portContexts.get(portId) : undefined) || this.getDefaultContext();
    if (!context) {
      logger.warn('[core] Cannot send packet: serial port not initialized');
      return false;
    }
    context.port.write(Buffer.from(packet));
    logger.info(
      {
        portId: context.portId,
        packet: packet.map((b) => b.toString(16).padStart(2, '0')).join(' '),
      },
      '[core] Raw packet sent',
    );
    return true;
  }

  /**
   * Get the loaded configuration
   */
  getConfig(): HomenetBridgeConfig | undefined {
    return this.config;
  }

  renameEntity(
    entityId: string,
    newName: string,
    uniqueId?: string,
  ): { success: boolean; error?: string } {
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

  revokeDiscovery(entityId: string): { success: boolean; error?: string } {
    if (this.portContexts.size === 0) {
      return { success: false, error: 'Bridge not initialized' };
    }

    // Try to revoke on all active ports/contexts to ensure cleanup
    for (const context of this.portContexts.values()) {
      context.discoveryManager.revokeDiscovery(entityId);
    }

    return { success: true };
  }

  startRawPacketListener(portId?: string): void {
    const targets = portId
      ? ([this.portContexts.get(portId)].filter(Boolean) as PortContext[])
      : [...this.portContexts.values()];
    targets.forEach((context) => this.attachRawListener(context));
  }

  stopRawPacketListener(portId?: string): void {
    const targets = portId
      ? ([this.portContexts.get(portId)].filter(Boolean) as PortContext[])
      : [...this.portContexts.values()];
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

    const defaults = this.config.packet_defaults || {};

    // 1. Construct an arbitrary "trigger" packet
    // This packet must satisfy the PacketParser (header, length, checksum)
    const header = defaults.rx_header || [];
    const footer = defaults.rx_footer || [];
    const headerLen = header.length;
    const footerLen = footer.length;
    const checksumType = defaults.rx_checksum;
    const checksum2Type = defaults.rx_checksum2;

    let targetLength = defaults.rx_length;
    if (!targetLength) {
      // If no fixed length, create a packet with some data
      // Header + 4 bytes random + Footer + Checksum
      let overhead = headerLen + footerLen;
      if (checksum2Type) overhead += 2;
      else if (checksumType && checksumType !== 'none') overhead += 1;
      targetLength = overhead + 4;
    }

    const testPacket = new Array(targetLength).fill(0);

    // Fill Header
    for (let i = 0; i < headerLen; i++) {
      testPacket[i] = header[i];
    }

    // Fill random data in the middle
    const checksumLen = checksum2Type ? 2 : checksumType && checksumType !== 'none' ? 1 : 0;
    const bodyStart = headerLen;
    const bodyEnd = targetLength - footerLen - checksumLen;

    for (let i = bodyStart; i < bodyEnd; i++) {
      testPacket[i] = Math.floor(Math.random() * 256);
    }

    // Fill Footer
    if (footerLen > 0) {
      for (let i = 0; i < footerLen; i++) {
        testPacket[targetLength - footerLen + i] = footer[i];
      }
    }

    // Calculate Checksum
    const buffer = Buffer.from(testPacket);
    if (checksumType && checksumType !== 'none') {
      if (typeof checksumType === 'string') {
        const cs = calculateChecksumFromBuffer(
          buffer,
          checksumType as ChecksumType,
          headerLen,
          bodyEnd,
        );
        testPacket[bodyEnd] = cs;
      }
    } else if (checksum2Type) {
      if (typeof checksum2Type === 'string') {
        const cs = calculateChecksum2FromBuffer(
          buffer,
          checksum2Type as Checksum2Type,
          headerLen,
          bodyEnd,
        );
        testPacket[bodyEnd] = cs[0];
        testPacket[bodyEnd + 1] = cs[1];
      }
    }

    // 2. Find a target for the response
    // We need ANY entity with ANY command to use as the action target.
    // The action doesn't actually execute on the device, we mock it.
    let targetEntity: EntityConfig | undefined;
    let targetCommand: string | undefined;

    for (const type of ENTITY_TYPE_KEYS) {
      const entities = this.config[type] as EntityConfig[] | undefined;
      if (entities && entities.length > 0) {
        for (const e of entities) {
          const cmdKey = Object.keys(e).find((k) => k.startsWith('command_'));
          if (cmdKey) {
            targetEntity = e;
            targetCommand = cmdKey.replace('command_', '');
            break;
          }
        }
      }
      if (targetEntity) break;
    }

    if (!targetEntity || !targetCommand) {
      // Fallback: If no entity/command exists, we can't run the test easily because Automation needs a target.
      throw new Error('No capable entities found for latency test action target.');
    }

    // 3. Setup Automation
    const automationId = `latency_test_${Date.now()}`;
    const automationConfig: AutomationConfig = {
      id: automationId,
      trigger: [
        {
          type: 'packet',
          match: {
            data: testPacket,
            mask: testPacket.map(() => 0xff), // Exact match
          },
        },
      ],
      then: [
        {
          action: 'command',
          target: `id(${targetEntity.id}).command_${targetCommand}()`,
        },
      ],
    };

    context.automationManager.addAutomation(automationConfig);

    // 4. Mock CommandManager
    const originalSend = context.commandManager.send;

    // Ignore updates for this entity in StateManager to prevent MQTT spam (though we are using a real entity now)
    context.stateManager.setIgnoreEntity(targetEntity.id);

    const measurements: number[] = [];
    let resolveTestIteration: (() => void) | null = null;

    // Replace send with our measurement hook
    context.commandManager.send = async (_entity, _packet) => {
      if (resolveTestIteration) resolveTestIteration();
      return Promise.resolve();
    };

    try {
      // 5. Loop 100 times
      for (let i = 0; i < 100; i++) {
        // Wait a bit to ensure clean state
        await new Promise((r) => setTimeout(r, 10));

        const start = performance.now();
        const iterationPromise = new Promise<void>((resolve) => {
          resolveTestIteration = resolve;
        });

        // Inject Trigger Packet
        context.stateManager.processIncomingData(Buffer.from(testPacket));

        // Wait for command generation (Automation -> CommandManager.send)
        const timeoutPromise = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 2000),
        );

        try {
          await Promise.race([iterationPromise, timeoutPromise]);
          const end = performance.now();
          measurements.push(end - start);
        } catch (e) {
          logger.warn('[LatencyTest] Timeout or error in iteration');
        }
      }
    } finally {
      // Cleanup
      context.commandManager.send = originalSend;
      context.automationManager.removeAutomation(automationId);
      context.stateManager.setIgnoreEntity(null);
    }

    // 6. Calculate Stats
    if (measurements.length === 0) return { avg: 0, stdDev: 0, min: 0, max: 0, samples: 0 };

    const sum = measurements.reduce((a, b) => a + b, 0);
    const avg = sum / measurements.length;
    const variance =
      measurements.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / measurements.length;
    const stdDev = Math.sqrt(variance);

    return {
      avg: Math.round(avg * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      min: Math.round(Math.min(...measurements) * 100) / 100,
      max: Math.round(Math.max(...measurements) * 100) / 100,
      samples: measurements.length,
    };
  }

  private buildStateProvider(portId: string): EntityStateProvider {
    return {
      getLightState: (entityId: string) =>
        this.portContexts.get(portId)?.stateManager.getLightState(entityId),
      getClimateState: (entityId: string) =>
        this.portContexts.get(portId)?.stateManager.getClimateState(entityId),
      getAllStates: () => this.portContexts.get(portId)?.stateManager.getAllStates() || {},
      getEntityState: (entityId: string) =>
        this.portContexts.get(portId)?.stateManager.getEntityState(entityId),
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
    const fallbackPortPrefix =
      this.resolvedPortTopicPrefixes.values().next().value || 'homedevice1';
    const effectivePortPrefix = (portPrefix || fallbackPortPrefix).toString().trim();

    return `${this.commonMqttTopicPrefix}/${effectivePortPrefix}`;
  }

  private async initialize() {
    this.resolvedPortTopicPrefixes.clear();

    this.config = this.options.configOverride ?? (await loadConfig(this.options.configPath));
    clearStateCache();
    this.commonMqttTopicPrefix = (this.options.mqttTopicPrefix || MQTT_TOPIC_PREFIX).trim();

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
      logger.info({ serialPath, portId: normalizedPortId }, '[core] Connecting to serial port...');

      let port: Duplex;
      try {
        port = await factory(serialPath, serialConfig);
        logger.info(
          { serialPath, portId: normalizedPortId },
          '[core] Successfully connected to serial port',
        );
      } catch (err) {
        logger.error(
          { err, serialPath, portId: normalizedPortId },
          '[core] Failed to connect to serial port',
        );
        throw err;
      }

      const stateProvider = this.buildStateProvider(normalizedPortId);
      // Create a shared states Map for this port context
      const states = new Map<string, Record<string, any>>();
      const packetProcessor = new PacketProcessor(this.config, stateProvider, states);
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
        states, // Pass the shared states map to StateManager
      );
      const commandManager = new CommandManager(
        port,
        this.config,
        normalizedPortId,
        packetProcessor,
      );
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
        normalizedPortId,
        (portId, packet, options) => {
          const context =
            (portId ? this.portContexts.get(portId) : undefined) || this.getDefaultContext();
          if (!context) {
            logger.warn('[core] Cannot send packet: serial port not initialized');
            return Promise.resolve();
          }
          return context.commandManager.sendRaw(packet, options);
        },
      );
      automationManager.start();

      // Intercept write for logging
      const originalWrite = port.write.bind(port);
      port.write = (
        chunk: any,
        encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
        cb?: (error: Error | null | undefined) => void,
      ): boolean => {
        // Handle argument shifting for write(chunk, cb)
        if (typeof encoding === 'function') {
          cb = encoding;
          encoding = undefined;
        }

        if (Buffer.isBuffer(chunk)) {
          const hexData = chunk.toString('hex');
          eventBus.emit('raw-tx-packet', {
            portId: normalizedPortId,
            payload: hexData,
            timestamp: new Date().toISOString(),
          });
        }
        return originalWrite(chunk, encoding as BufferEncoding, cb);
      };

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
        // logger.debug({ portId: context.portId, interval, count: context.packetIntervals.length }, '[core] Interval Pushed');
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
      // Do not clear packetIntervals so we can recall stats in log metadata even if stream paused
      context.lastPacketTimestamp = null;
    }
  }

  public getPacketIntervalStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const context of this.portContexts.values()) {
      logger.info(
        { portId: context.portId, intervalCount: context.packetIntervals.length },
        '[core] getPacketIntervalStats called',
      );
      stats[context.portId] = this.calculateStatsForContext(context);
    }
    return stats;
  }

  private analyzeAndEmitPacketStats(context: PortContext) {
    const stats = this.calculateStatsForContext(context);
    eventBus.emit('packet-interval-stats', stats);
  }

  private calculateStatsForContext(context: PortContext) {
    const intervals = [...context.packetIntervals];
    // Do not clear the buffer; it's a rolling window managed in attachRawListener

    if (intervals.length === 0) {
      return {
        portId: context.portId,
        packetAvg: 0,
        packetStdDev: 0,
        idleAvg: 0,
        idleStdDev: 0,
        idleOccurrenceAvg: 0,
        idleOccurrenceStdDev: 0,
        sampleSize: 0,
      };
    }

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

    return {
      portId: context.portId,
      packetAvg: round(packetStats.avg),
      packetStdDev: round(packetStats.stdDev),
      idleAvg: round(idleStats.avg),
      idleStdDev: round(idleStats.stdDev),
      idleOccurrenceAvg: round(idleOccurrenceStats.avg),
      idleOccurrenceStdDev: round(idleOccurrenceStats.stdDev),
      sampleSize: intervals.length,
    };
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
