// packages/core/src/service/bridge.service.ts

import { Duplex } from 'stream';

import { logger } from '../utils/logger.js';
import { HomenetBridgeConfig } from '../config/types.js';
import { loadConfig } from '../config/index.js';
import { EntityConfig } from '../domain/entities/base.entity.js';
import { PacketProcessor, EntityStateProvider } from '../protocol/packet-processor.js';
import { createSerialPortConnection } from '../transports/serial/serial.factory.js';
import { MqttClient } from '../transports/mqtt/mqtt.client.js';
import { MqttSubscriber } from '../transports/mqtt/subscriber.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { StateManager } from '../state/state-manager.js';
import { getStateCache } from '../state/store.js';
import { DiscoveryManager } from '../mqtt/discovery-manager.js'; // Import DiscoveryManager

// Redefine BridgeOptions to use the new HomenetBridgeConfig
export interface BridgeOptions {
  configPath: string; // Path to the homenet_bridge.yaml configuration file
  mqttUrl: string;
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
  private discoveryManager?: DiscoveryManager; // DiscoveryManager instance

  constructor(options: BridgeOptions) {
    this.options = options;
    this._mqttClient = new MqttClient(options.mqttUrl, {
      will: {
        topic: 'homenet/bridge/status',
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    });
    this.client = this._mqttClient.client; // Assign the client from the new MqttClient instance
    this.connectionPromise = this._mqttClient.connectionPromise; // Assign the promise from the new MqttClient instance
  }

  // Implement EntityStateProvider methods
  getLightState(entityId: string): { isOn: boolean } | undefined {
    const topic = `homenet/${entityId}/state`;
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
    const topic = `homenet/${entityId}/state`;
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

    // Instantiate MqttPublisher
    this.mqttPublisher = new MqttPublisher(this._mqttClient);

    // Instantiate StateManager
    this.stateManager = new StateManager(this.config, this.packetProcessor, this.mqttPublisher);

    // Now instantiate MqttSubscriber with the available port
    this.mqttSubscriber = new MqttSubscriber(
      this._mqttClient,
      this.config,
      this.packetProcessor,
      this.port,
    );


    // Set up subscriptions
    if (this._mqttClient.isConnected) {
      this.mqttSubscriber.setupSubscriptions();
    } else {
      this.client.on('connect', () => this.mqttSubscriber!.setupSubscriptions());
    }

    // Initialize DiscoveryManager
    this.discoveryManager = new DiscoveryManager(this.config, this.mqttPublisher, this.mqttSubscriber);
    this.discoveryManager.setup();

    if (this._mqttClient.isConnected) {
      this.discoveryManager.discover();
    } else {
      this.client.on('connect', () => this.discoveryManager!.discover());
    }

    this.port.on('data', (data) => {
      if (this.stateManager) {
        this.stateManager.processIncomingData(data);
      }
    });
    this.port.on('error', (err) => {
      logger.error({ err, serialPath }, '[core] 시리얼 포트 오류');
    });
  }
}
