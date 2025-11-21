// packages/core/src/transports/mqtt/mqtt.client.ts
import mqtt from 'mqtt';
import { logger } from '../../utils/logger.js';

const DEFAULT_MQTT_CONNECT_TIMEOUT_MS = 10000; // Default to 10 seconds

const resolveMqttConnectTimeout = () => {
  const raw = process.env.MQTT_CONNECT_TIMEOUT_MS ?? '';
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_MQTT_CONNECT_TIMEOUT_MS;
  }
  return parsed;
};

const MQTT_CONNECT_TIMEOUT_MS = resolveMqttConnectTimeout();

export class MqttClient {
  public readonly client: mqtt.MqttClient;
  public readonly connectionPromise: Promise<void>;

  constructor(mqttUrl: string, options: mqtt.IClientOptions = {}) {
    logger.debug(
      { mqttUrl, connectTimeout: MQTT_CONNECT_TIMEOUT_MS, options },
      '[mqtt-client] Initializing MQTT client with options',
    );

    this.client = mqtt.connect(mqttUrl, {
      connectTimeout: MQTT_CONNECT_TIMEOUT_MS,
      ...options,
    });

    this.connectionPromise = new Promise<void>((resolve, reject) => {
      const errorHandler = (err: Error) => {
        logger.error({ err }, '[mqtt-client] MQTT 연결 오류 (백그라운드)');
        // Note: The original implementation in bridge.service.ts did not reject here to avoid stopping the main process.
        // We maintain this behavior for now.
      };

      const connectHandler = () => {
        logger.info(`[mqtt-client] MQTT에 연결되었습니다: ${mqttUrl}`);
        this.client.off('error', errorHandler); // Remove error handler once connected
        resolve();
      };

      this.client.on('connect', connectHandler);
      this.client.on('error', errorHandler);
    });
  }

  public get isConnected(): boolean {
    return this.client.connected;
  }

  public end(): void {
    this.client.end();
  }
}
