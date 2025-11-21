import { HomenetBridgeConfig } from '../config/types.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { MqttSubscriber } from '../transports/mqtt/subscriber.js';
import { logger } from '../utils/logger.js';

interface DiscoveryPayload {
    name: string | null;
    unique_id: string;
    state_topic: string;
    command_topic?: string;
    availability?: { topic: string }[];
    device: {
        identifiers: string[];
        name: string;
        manufacturer: string;
        model?: string;
        sw_version?: string;
    };
    [key: string]: any;
}

export class DiscoveryManager {
    private config: HomenetBridgeConfig;
    private publisher: MqttPublisher;
    private subscriber: MqttSubscriber;
    private readonly discoveryPrefix = 'homeassistant';
    private readonly bridgeStatusTopic = 'homenet/bridge/status';

    constructor(
        config: HomenetBridgeConfig,
        publisher: MqttPublisher,
        subscriber: MqttSubscriber,
    ) {
        this.config = config;
        this.publisher = publisher;
        this.subscriber = subscriber;
    }

    public setup(): void {
        // Subscribe to Home Assistant status to republish discovery on restart
        this.subscriber.subscribe(`${this.discoveryPrefix}/status`, (message) => {
            const status = message.toString();
            if (status === 'online') {
                logger.info('[DiscoveryManager] Home Assistant is online, republishing discovery configs');
                this.discover();
            }
        });

        // Publish bridge online status
        this.publisher.publish(this.bridgeStatusTopic, 'online', { retain: true });
        logger.info('[DiscoveryManager] Published bridge online status');
    }

    public discover(): void {
        logger.info('[DiscoveryManager] Starting discovery process');

        const entities = [
            ...(this.config.light || []).map((e) => ({ ...e, type: 'light' })),
            ...(this.config.climate || []).map((e) => ({ ...e, type: 'climate' })),
            ...(this.config.valve || []).map((e) => ({ ...e, type: 'switch' })), // Map valve to switch for now if not supported
            ...(this.config.button || []).map((e) => ({ ...e, type: 'button' })),
            ...(this.config.sensor || []).map((e) => ({ ...e, type: 'sensor' })),
            ...(this.config.fan || []).map((e) => ({ ...e, type: 'fan' })),
            ...(this.config.switch || []).map((e) => ({ ...e, type: 'switch' })),
            ...(this.config.binary_sensor || []).map((e) => ({ ...e, type: 'binary_sensor' })),
        ];

        for (const entity of entities) {
            this.publishDiscovery(entity);
        }
    }

    private publishDiscovery(entity: any): void {
        const { id, name, type, ...rest } = entity;
        const uniqueId = `homenet_${id}`;
        const topic = `${this.discoveryPrefix}/${type}/${uniqueId}/config`;

        const payload: DiscoveryPayload = {
            name: name || null,
            unique_id: uniqueId,
            state_topic: `homenet/${id}/state`,
            availability: [{ topic: this.bridgeStatusTopic }],
            device: {
                identifiers: [uniqueId],
                name: name || `Device ${id}`,
                manufacturer: 'RS485 Bridge',
                model: type,
            },
            ...rest,
        };

        if (['light', 'switch', 'fan', 'climate', 'button'].includes(type)) {
            payload.command_topic = `homenet/${id}/set`;
        }

        // Add specific device class or other properties if needed
        if (type === 'climate') {
            // Climate specific defaults if not in config
            // e.g. modes, temp steps etc.
        }

        this.publisher.publish(topic, JSON.stringify(payload), { retain: false });
        logger.debug({ topic, uniqueId }, '[DiscoveryManager] Published discovery config');
    }
}
