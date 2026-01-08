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
  public async clearRetainedMessages(topicPrefix: string): Promise<number> {
    if (!this.client.connected) {
      throw new Error('MQTT client is not connected');
    }

    return new Promise((resolve, reject) => {
      const topicsToDelete = new Set<string>();
      const searchTopic = `${topicPrefix.endsWith('/') ? topicPrefix : topicPrefix + '/'}#`;

      logger.info({ searchTopic }, '[mqtt-client] Starting scan for retained messages to clear');

      const messageHandler = (topic: string, message: Buffer, packet: mqtt.Packet) => {
        if ((packet as any).retain) {
          topicsToDelete.add(topic);
        }
      };

      // Create a temporary client for scanning to avoid interfering with the main client's subscriptions
      // Reuse the existing client's options but with a new client ID
      const scanClient = mqtt.connect(this.client.options.host || 'localhost', {
        ...this.client.options,
        clientId: `mqtt-cleaner-${Date.now()}`,
      });

      scanClient.on('connect', () => {
        scanClient.subscribe(searchTopic);
        scanClient.on('message', messageHandler);

        // Wait for 2 seconds to collect retained messages
        setTimeout(() => {
          scanClient.end();

          if (topicsToDelete.size === 0) {
            logger.info('[mqtt-client] No retained messages found to clear');
            resolve(0);
            return;
          }

          logger.info({ count: topicsToDelete.size }, '[mqtt-client] Clearing retained messages');

          let clearedCount = 0;
          const promises = Array.from(topicsToDelete).map((topic) => {
            return new Promise<void>((pubResolve) => {
              this.client.publish(topic, Buffer.alloc(0), { retain: true, qos: 1 }, (err) => {
                if (err) {
                  logger.warn({ topic, err }, '[mqtt-client] Failed to clear topic');
                } else {
                  clearedCount++;
                }
                pubResolve();
              });
            });
          });

          Promise.all(promises).then(() => {
            logger.info({ clearedCount }, '[mqtt-client] Finished clearing retained messages');
            resolve(clearedCount);
          });
        }, 2000);
      });

      scanClient.on('error', (err) => {
        scanClient.end();
        logger.error({ err }, '[mqtt-client] Error during retained message scan');
        reject(err);
      });
    });
  }
}
