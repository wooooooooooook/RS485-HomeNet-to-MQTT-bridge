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

// Redefine BridgeOptions to use the new HomenetBridgeConfig
export interface BridgeOptions {
  configPath: string; // Path to the homenet_bridge.yaml configuration file
  mqttUrl: string;
  mqttUsername?: string;
  mqttPassword?: string;
}

export class HomeNetBridge implements EntityStateProvider {
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
    this._mqttClient.end();
    if (this.port) {
      this.port.removeAllListeners();
      this.port.destroy();
      this.port = undefined;
    }
    this.startPromise = null;
  }

  private async initialize() {
    this.config = await loadConfig(this.options.configPath);
    this.packetProcessor = new PacketProcessor(this.config, this);
    logger.debug('[core] PacketProcessor initialized.');

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

    this.port.on('data', (data) => {
      const now = Date.now();
      let interval: number | null = null;

      if (this.lastPacketTimestamp) {
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

      if (this.packetIntervals.length >= 100) {
        this.analyzeAndEmitPacketStats();
      }

      if (this.stateManager) {
        this.stateManager.processIncomingData(data);
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

    eventBus.emit('packet-interval-stats', {
      packetAvg: Math.round(packetStats.avg),
      packetStdDev: parseFloat(packetStats.stdDev.toFixed(2)),
      idleAvg: Math.round(idleStats.avg),
      idleStdDev: parseFloat(idleStats.stdDev.toFixed(2)),
      sampleSize: intervals.length,
      idleOccurrenceAvg: Math.round(idleOccurrenceStats.avg),
      idleOccurrenceStdDev: parseFloat(idleOccurrenceStats.stdDev.toFixed(2)),
    });
  }
}
