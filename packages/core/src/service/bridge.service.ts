// packages/core/src/service/bridge.service.ts

import { Duplex } from 'stream';

import { logger } from '../utils/logger.js';
import { MQTT_TOPIC_PREFIX } from '../utils/constants.js';
import { HomenetBridgeConfig } from '../config/types.js';
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
import { getStateCache } from '../state/store.js';
import { DiscoveryManager } from '../mqtt/discovery-manager.js'; // Import DiscoveryManager
import mqtt from 'mqtt';
import { ENTITY_TYPE_KEYS, findEntityById } from '../utils/entities.js';
import { AutomationManager } from '../automation/automation-manager.js';

// Redefine BridgeOptions to use the new HomenetBridgeConfig
export interface BridgeOptions {
  configPath: string; // Path to the homenet_bridge.yaml configuration file
  mqttUrl: string;
  mqttUsername?: string;
  mqttPassword?: string;
}

export class HomeNetBridge implements EntityStateProvider {
  private readonly minPacketIntervalsForStats = 10;
  private readonly options: BridgeOptions;
  private readonly _mqttClient: MqttClient; // New internal instance
  private readonly client: MqttClient['client']; // Reference to the actual mqtt client
  private port?: Duplex;
  private startPromise: Promise<void> | null = null;
  private connectionPromise: Promise<void>;

  private config?: HomenetBridgeConfig; // Loaded configuration
  private packetProcessor?: PacketProcessor; // The new packet processor
  private mqttSubscriber?: MqttSubscriber; // New MQTT subscriber instance
  private mqttPublisher?: MqttPublisher; // New MQTT publisher instance
  private stateManager?: StateManager; // New StateManager instance
  private commandManager?: CommandManager;
  private discoveryManager?: DiscoveryManager; // DiscoveryManager instance
  private lastPacketTimestamp: number | null = null;
  private packetIntervals: number[] = [];
  private hrtimeBase: bigint = process.hrtime.bigint(); // Base time for monotonic clock
  private automationManager?: AutomationManager;
  private rawPacketListener: ((data: Buffer) => void) | null = null;

  constructor(options: BridgeOptions) {
    this.options = options;
    const mqttOptions: mqtt.IClientOptions = {
      will: {
        topic: `${MQTT_TOPIC_PREFIX}/bridge/status`,
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    };

    if (options.mqttUsername) {
      mqttOptions.username = options.mqttUsername;
    }
    if (options.mqttPassword) {
      mqttOptions.password = options.mqttPassword;
    }

    this._mqttClient = new MqttClient(options.mqttUrl, mqttOptions);
    this.client = this._mqttClient.client; // Assign the client from the new MqttClient instance
    this.connectionPromise = this._mqttClient.connectionPromise; // Assign the promise from the new MqttClient instance
  }

  // Implement EntityStateProvider methods
  getLightState(entityId: string): { isOn: boolean } | undefined {
    const topic = `${MQTT_TOPIC_PREFIX}/${entityId}/state`;
    const state = getStateCache().get(topic); // Use getStateCache()
    if (state) {
      const parsedState = JSON.parse(state);
      if (typeof parsedState.isOn === 'boolean') {
        return { isOn: parsedState.isOn };
      }
    }
    return undefined;
  }

  getClimateState(entityId: string): { targetTemperature: number } | undefined {
    const topic = `${MQTT_TOPIC_PREFIX}/${entityId}/state`;
    const state = getStateCache().get(topic); // Use getStateCache()
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
      await this.startPromise.catch(() => { });
    }
    this.stopRawPacketListener();
    this.automationManager?.stop();
    this._mqttClient.end();
    if (this.port) {
      this.port.removeAllListeners();
      this.port.destroy();
      this.port = undefined;
    }
    this.startPromise = null;
  }

  /**
   * Send a raw packet directly to the serial port without ACK waiting
   */
  sendRawPacket(packet: number[]): boolean {
    if (!this.port) {
      logger.warn('[core] Cannot send packet: serial port not initialized');
      return false;
    }
    this.port.write(Buffer.from(packet));
    logger.info({ packet: packet.map(b => b.toString(16).padStart(2, '0')).join(' ') }, '[core] Raw packet sent');
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

  /**
   * Execute a command by mocking subscriber behavior
   * This mimics what handleMqttMessage does when receiving a set topic
   */
  /**
   * Starts listening for raw packets from the serial port and emitting events.
   */
  startRawPacketListener(): void {
    if (!this.port || this.rawPacketListener) {
      return;
    }

    logger.info('[core] Starting raw packet listener.');

    this.rawPacketListener = (data: Buffer) => {
      // Use high-resolution monotonic clock for accurate intervals
      const hrNow = process.hrtime.bigint();
      const now = Number((hrNow - this.hrtimeBase) / 1000000n); // Convert to ms

      let interval: number | null = null;

      if (this.lastPacketTimestamp !== null) {
        interval = now - this.lastPacketTimestamp;
        this.packetIntervals.push(interval);
        if (this.packetIntervals.length > 1000) {
          this.packetIntervals.shift();
        }
      }

      this.lastPacketTimestamp = now;

      const hexData = data.toString('hex');
      eventBus.emit('raw-data-with-interval', {
        payload: hexData,
        interval,
        receivedAt: new Date().toISOString(),
      });

      if (this.packetIntervals.length >= this.minPacketIntervalsForStats) {
        this.analyzeAndEmitPacketStats();
      }

      if (this.stateManager) {
        this.stateManager.processIncomingData(data);
      }
    };

    this.port.on('data', this.rawPacketListener);
  }

  /**
   * Stops listening for raw packets.
   */
  stopRawPacketListener(): void {
    if (this.port && this.rawPacketListener) {
      logger.info('[core] Stopping raw packet listener.');
      this.port.off('data', this.rawPacketListener);
      this.rawPacketListener = null;

      // Reset stats
      this.packetIntervals = [];
      this.lastPacketTimestamp = null;
    }
  }

  async executeCommand(
    entityId: string,
    commandName: string,
    value?: number | string,
  ): Promise<{ success: boolean; packet?: string; error?: string }> {
    if (!this.config || !this.packetProcessor || !this.commandManager) {
      return { success: false, error: 'Bridge not initialized' };
    }

    // Find entity in config (same logic as subscriber)
    const targetEntity = findEntityById(this.config, entityId);

    if (!targetEntity) {
      return { success: false, error: `Entity ${entityId} not found` };
    }

    // Construct command packet using packetProcessor (same as subscriber)
    const commandPacket = this.packetProcessor.constructCommandPacket(
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
      timestamp: new Date().toISOString(),
    });

    // Send command via commandManager (same as subscriber)
    try {
      await this.commandManager.send(targetEntity, commandPacket);
      return { success: true, packet: hexPacket };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, packet: hexPacket, error: message };
    }
  }

  private async initialize() {
    this.config = await loadConfig(this.options.configPath);
    this.packetProcessor = new PacketProcessor(this.config, this);
    logger.debug('[core] PacketProcessor initialized.');

    this.packetProcessor.on('parsed-packet', (data) => {
      const { deviceId, packet, state } = data;
      const hexPacket = packet.map((b: number) => b.toString(16).padStart(2, '0')).join('');
      eventBus.emit('parsed-packet', {
        entityId: deviceId,
        packet: hexPacket,
        state,
        timestamp: new Date().toISOString(),
      });
    });

    const { serial: serialConfig } = this.config;

    logger.info('[core] MQTT 연결을 백그라운드에서 대기하며 시리얼 포트 연결을 진행합니다.');

    const serialPath = process.env.SERIAL_PORT || '/simshare/rs485-sim-tty';

    // Establish serial connection first
    this.port = await createSerialPortConnection(serialPath, serialConfig);

    // Instantiate CommandManager
    this.commandManager = new CommandManager(this.port, this.config);

    // Instantiate MqttPublisher
    this.mqttPublisher = new MqttPublisher(this._mqttClient);

    // Instantiate StateManager
    this.stateManager = new StateManager(this.config, this.packetProcessor, this.mqttPublisher);

    // Now instantiate MqttSubscriber with the CommandManager
    this.mqttSubscriber = new MqttSubscriber(
      this._mqttClient,
      this.config,
      this.packetProcessor,
      this.commandManager,
    );

    // Set up subscriptions
    if (this._mqttClient.isConnected) {
      this.mqttSubscriber.setupSubscriptions();
    } else {
      this.client.on('connect', () => this.mqttSubscriber!.setupSubscriptions());
    }

    // Initialize DiscoveryManager
    this.discoveryManager = new DiscoveryManager(
      this.config,
      this.mqttPublisher,
      this.mqttSubscriber,
    );
    this.discoveryManager.setup();

    if (this._mqttClient.isConnected) {
      this.discoveryManager.discover();
    } else {
      this.client.on('connect', () => this.discoveryManager!.discover());
    }

    this.automationManager = new AutomationManager(
      this.config,
      this.packetProcessor,
      this.commandManager,
      this.mqttPublisher,
    );
    this.automationManager.start();

    this.port.on('data', (data) => {
      if (!this.rawPacketListener) {
        this.stateManager?.processIncomingData(data);
      }
    });

    this.port.on('error', (err) => {
      logger.error({ err, serialPath }, '[core] 시리얼 포트 오류');
    });
  }

  private analyzeAndEmitPacketStats() {
    const intervals = [...this.packetIntervals];

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

    // Calculate average interval between idle occurrences
    const idleOccurrenceIntervals: number[] = [];
    if (idleIndices.length > 1) {
      for (let i = 1; i < idleIndices.length; i++) {
        let durationBetweenIdles = 0;
        for (let j = idleIndices[i - 1] + 1; j <= idleIndices[i]; j++) {
          durationBetweenIdles += intervals[j];
        }
        idleOccurrenceIntervals.push(durationBetweenIdles);
      }
    }
    const idleOccurrenceStats = calculateStats(idleOccurrenceIntervals);

    const stats = {
      packetAvg: Math.round(packetStats.avg),
      packetStdDev: parseFloat(packetStats.stdDev.toFixed(2)),
      idleAvg: Math.round(idleStats.avg),
      idleStdDev: parseFloat(idleStats.stdDev.toFixed(2)),
      sampleSize: intervals.length,
      idleOccurrenceAvg: Math.round(idleOccurrenceStats.avg),
      idleOccurrenceStdDev: parseFloat(idleOccurrenceStats.stdDev.toFixed(2)),
    };

    // Debug: Check for invalid stats
    if (stats.packetAvg < 0 || isNaN(stats.packetAvg)) {
      logger.warn({ stats, packetIntervals, intervals: intervals.slice(0, 10) }, '[core] Invalid packet stats detected');
    }

    eventBus.emit('packet-interval-stats', stats);
  }

  private findEntityConfig(entityId: string): { entity: EntityConfig; type: string } | null {
    if (!this.config) {
      return null;
    }

    for (const type of ENTITY_TYPE_KEYS) {
      const entities = this.config[type] as EntityConfig[] | undefined;
      if (!entities) continue;

      const entity = entities.find((candidate) => candidate.id === entityId);
      if (entity) {
        return { entity, type: String(type) };
      }
    }

    return null;
  }
}
