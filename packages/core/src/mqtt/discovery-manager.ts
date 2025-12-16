import { DeviceConfig, HomenetBridgeConfig } from '../config/types.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { MqttSubscriber } from '../transports/mqtt/subscriber.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../service/event-bus.js';
import { EntityConfig } from '../domain/entities/base.entity.js';

interface DiscoveryPayload {
  name: string | null;
  object_id?: string;
  unique_id: string;
  availability?: { topic: string }[];
  device: {
    identifiers: string[];
    name: string;
    manufacturer: string;
    model?: string;
    sw_version?: string;
    suggested_area?: string;
  };
  state_topic: string;
  command_topic?: string;
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: string;
  icon?: string;
  value_template?: string;
  payload_on?: string;
  payload_off?: string;
  state_on?: string;
  state_off?: string;
  suggested_area?: string;
  [key: string]: any;
}

export class DiscoveryManager {
  private portId: string;
  private config: HomenetBridgeConfig;
  private publisher: MqttPublisher;
  private subscriber: MqttSubscriber;
  private mqttTopicPrefix: string;
  private readonly discoveryPrefix = 'homeassistant';
  private readonly bridgeStatusTopic: string;
  private readonly rediscoveryDelayMs = 2000;
  private readonly entities: Array<EntityConfig & { type: string }>;
  private readonly devicesById = new Map<string, DeviceConfig>();
  private readonly stateReceived = new Set<string>();
  private readonly discoveryPublished = new Set<string>();

  constructor(
    portId: string,
    config: HomenetBridgeConfig,
    publisher: MqttPublisher,
    subscriber: MqttSubscriber,
    mqttTopicPrefix: string,
  ) {
    this.portId = portId;
    this.config = config;
    this.publisher = publisher;
    this.subscriber = subscriber;
    this.mqttTopicPrefix = mqttTopicPrefix;
    this.bridgeStatusTopic = `${this.mqttTopicPrefix}/bridge/status`;
    this.registerDevices();
    this.entities = this.collectEntities();
  }

  public revokeDiscovery(entityId: string): void {
    const entity = this.entities.find((e) => e.id === entityId);
    if (!entity) {
      logger.warn({ entityId }, '[DiscoveryManager] Cannot revoke discovery for unknown entity');
      return;
    }

    const uniqueId = this.ensureUniqueId(entity);
    const topic = `${this.discoveryPrefix}/${entity.type}/${uniqueId}/config`;

    this.publisher.publish(topic, '', { retain: true });

    const discoveryKey = `${this.portId}:${entityId}`;
    this.discoveryPublished.delete(discoveryKey);

    logger.info({ entityId, topic }, '[DiscoveryManager] Revoked discovery for entity');
  }

  public setup(): void {
    // Subscribe to Home Assistant status to republish discovery on restart
    this.subscriber.subscribe(`${this.discoveryPrefix}/status`, (message) => {
      const status = message.toString();
      if (status === 'online') {
        logger.info('[DiscoveryManager] Home Assistant is online, republishing discovery configs');
        this.republishDiscovered();
      }
    });

    eventBus.on('state:changed', ({ entityId, portId }) => {
      if (portId && portId !== this.portId) return;
      this.handleStateReceived(entityId);
    });

    eventBus.on('entity:renamed', ({ entityId, newName }: { entityId: string; newName: string }) => {
      this.handleEntityRenamed(entityId, newName);
    });

    // Publish bridge online status
    this.publisher.publish(this.bridgeStatusTopic, 'online', { retain: true });
    logger.info('[DiscoveryManager] Published bridge online status');
  }

  public discover(): void {
    logger.info('[DiscoveryManager] Checking discovery eligibility for configured entities');

    for (const entity of this.entities) {
      this.publishDiscoveryIfEligible(entity);
    }
  }

  private collectEntities(): Array<EntityConfig & { type: string }> {
    return [
      ...(this.config.light || []).map((e) => ({ ...e, type: 'light' })),
      ...(this.config.climate || []).map((e) => ({ ...e, type: 'climate' })),
      ...(this.config.valve || []).map((e) => ({ ...e, type: 'valve' })),
      ...(this.config.button || []).map((e) => ({ ...e, type: 'button' })),
      ...(this.config.sensor || []).map((e) => ({ ...e, type: 'sensor' })),
      ...(this.config.fan || []).map((e) => ({ ...e, type: 'fan' })),
      ...(this.config.switch || []).map((e) => ({ ...e, type: 'switch' })),
      ...(this.config.lock || []).map((e) => ({ ...e, type: 'lock' })),
      ...(this.config.number || []).map((e) => ({ ...e, type: 'number' })),
      ...(this.config.select || []).map((e) => ({ ...e, type: 'select' })),
      ...(this.config.text_sensor || []).map((e) => ({ ...e, type: 'text_sensor' })),
      ...(this.config.text || []).map((e) => ({ ...e, type: 'text' })),
      ...(this.config.binary_sensor || []).map((e) => ({ ...e, type: 'binary_sensor' })),
    ];
  }

  private registerDevices(): void {
    for (const device of this.config.devices || []) {
      if (!device.id) {
        logger.warn('[DiscoveryManager] Skipping device without id in config');
        continue;
      }
      this.devicesById.set(device.id, device);
    }
  }

  private defaultBridgeDevice(): DiscoveryPayload['device'] {
    return {
      identifiers: [`homenet_bridge_device_${this.portId}`],
      name: `Homenet Bridge (${this.portId})`,
      manufacturer: 'RS485 Bridge',
      model: 'Bridge',
    };
  }

  private buildDevicePayload(deviceId?: string): DiscoveryPayload['device'] {
    if (!deviceId) {
      return this.defaultBridgeDevice();
    }

    const device = this.devicesById.get(deviceId);
    if (!device) {
      logger.warn({ deviceId }, '[DiscoveryManager] Referenced device not found, using bridge device info');
      return this.defaultBridgeDevice();
    }

    return {
      identifiers: [`homenet_device_${this.portId}_${device.id}`],
      name: device.name || device.id,
      manufacturer: device.manufacturer || 'RS485 Bridge',
      model: device.model,
      sw_version: device.sw_version,
      suggested_area: device.area,
    };
  }

  private handleStateReceived(entityId: string): void {
    this.stateReceived.add(`${this.portId}:${entityId}`);

    for (const entity of this.entities) {
      if (entity.id === entityId || entity.discovery_linked_id === entityId) {
        this.publishDiscoveryIfEligible(entity);
      }
    }
  }

  private handleEntityRenamed(entityId: string, newName: string): void {
    const entity = this.entities.find((candidate) => candidate.id === entityId);

    if (!entity) {
      logger.warn({ entityId }, '[DiscoveryManager] Attempted to rename unknown entity');
      return;
    }

    const uniqueId = this.ensureUniqueId(entity);
    const topic = `${this.discoveryPrefix}/${entity.type}/${uniqueId}/config`;

    this.publisher.publish(topic, '', { retain: true });
    logger.debug({ topic }, '[DiscoveryManager] Cleared retained discovery for renamed entity');

    setTimeout(() => {
      entity.name = newName;
      entity.unique_id = uniqueId;
      this.publishDiscoveryIfEligible(entity, true);
    }, this.rediscoveryDelayMs);
  }

  private ensureUniqueId(entity: EntityConfig): string {
    if (!entity.unique_id) {
      entity.unique_id = `homenet_${this.portId}_${entity.id}`;
    }
    return entity.unique_id;
  }

  private buildObjectId(entity: EntityConfig): string {
    const source = entity.name || entity.id;
    return source
      .toString()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }

  private publishDiscoveryIfEligible(entity: EntityConfig & { type: string }, force = false): void {
    if (!entity.id) {
      logger.error({ entity }, '[DiscoveryManager] Entity missing ID, skipping discovery');
      return;
    }

    const discoveryKey = `${this.portId}:${entity.id}`;

    if (this.discoveryPublished.has(discoveryKey) && !force) {
      return;
    }

    const hasState = this.stateReceived.has(`${this.portId}:${entity.id}`);
    const alwaysPublish = entity.discovery_always === true;
    const linkedReady =
      typeof entity.discovery_linked_id === 'string'
        ? this.stateReceived.has(`${this.portId}:${entity.discovery_linked_id}`)
        : false;

    if (!alwaysPublish && !hasState && !linkedReady && !force) {
      logger.debug({ id: entity.id }, '[DiscoveryManager] Discovery deferred until state packet received');
      return;
    }

    if (linkedReady && !this.discoveryPublished.has(`${this.portId}:${entity.discovery_linked_id || ''}`)) {
      logger.debug(
        {
          id: entity.id,
          discovery_linked_id: entity.discovery_linked_id,
        },
        '[DiscoveryManager] Publishing discovery linked to another entity state',
      );
    }

    this.publishDiscovery(entity);
    this.discoveryPublished.add(discoveryKey);
  }

  private republishDiscovered(): void {
    for (const entityId of this.discoveryPublished) {
      const [, id] = entityId.split(':');
      const entity = this.entities.find((candidate) => candidate.id === id);
      if (entity) {
        this.publishDiscoveryIfEligible(entity, true);
      }
    }
  }

  private publishDiscovery(entity: any): void {
    // Only extract essential identification fields
    const { id, name, type } = entity;

    if (!id) {
      logger.error({ entity }, '[DiscoveryManager] Entity missing ID, skipping discovery');
      return;
    }

    const uniqueId = this.ensureUniqueId(entity);
    const objectId = this.buildObjectId(entity);
    const topic = `${this.discoveryPrefix}/${type}/${uniqueId}/config`;

    logger.debug({ id, uniqueId, topic }, '[DiscoveryManager] Preparing discovery');

    // Base payload with mandatory fields only
    const payload: DiscoveryPayload = {
      name: name || null,
      object_id: objectId,
      unique_id: uniqueId,
      state_topic: `${this.mqttTopicPrefix}/${id}/state`,
      availability: [{ topic: this.bridgeStatusTopic }],
      device: this.buildDevicePayload(entity.device),
    };

    if (entity.area) {
      payload.suggested_area = entity.area;
    }

    // Add optional standard fields if present
    if (entity.device_class) {
      payload.device_class = entity.device_class;
    }
    if (entity.unit_of_measurement) {
      payload.unit_of_measurement = entity.unit_of_measurement;
    }
    if (entity.state_class) {
      payload.state_class = entity.state_class;
    }
    if (entity.icon) {
      payload.icon = entity.icon;
    }

    if (['light', 'switch', 'fan', 'button', 'lock', 'number', 'select', 'text'].includes(type)) {
      payload.command_topic = `${this.mqttTopicPrefix}/${id}/set`;
    }

    // Entity specific configurations
    switch (type) {
      case 'switch':
        // Extract state from JSON (devices publish 'state': 'ON'/'OFF')
        payload.value_template = '{{ value_json.state }}';
        // Command payloads
        payload.payload_on = 'ON';
        payload.payload_off = 'OFF';
        break;

      case 'light':
        // Extract state from JSON
        payload.state_value_template = '{{ value_json.state }}';
        payload.payload_on = 'ON';
        payload.payload_off = 'OFF';

        // Brightness support
        if (entity.state_brightness || entity.command_brightness) {
          payload.brightness_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.brightness_command_topic = `${this.mqttTopicPrefix}/${id}/brightness/set`;
          payload.brightness_scale = 255;
          payload.brightness_value_template = '{{ value_json.brightness }}';
        }

        // RGB color support
        if (entity.state_red || entity.state_green || entity.state_blue) {
          payload.rgb_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.rgb_command_topic = `${this.mqttTopicPrefix}/${id}/rgb/set`;
          payload.rgb_value_template =
            '{{ value_json.red }},{{ value_json.green }},{{ value_json.blue }}';
        }

        // Color temperature support (mireds)
        if (entity.state_color_temp || entity.command_color_temp) {
          payload.color_temp_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.color_temp_command_topic = `${this.mqttTopicPrefix}/${id}/color_temp/set`;
          payload.color_temp_value_template = '{{ value_json.color_temp }}';

          if (entity.min_mireds !== undefined) {
            payload.min_mireds = entity.min_mireds;
          }
          if (entity.max_mireds !== undefined) {
            payload.max_mireds = entity.max_mireds;
          }
        }

        // Effect support
        if (entity.effect_list && entity.effect_list.length > 0) {
          payload.effect_list = entity.effect_list;
          payload.effect_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.effect_command_topic = `${this.mqttTopicPrefix}/${id}/effect/set`;
          payload.effect_value_template = '{{ value_json.effect }}';
        }
        break;

      case 'lock':
        // Lock state (LOCKED, UNLOCKED, LOCKING, UNLOCKING, JAMMED)
        payload.state_locked = 'LOCKED';
        payload.state_unlocked = 'UNLOCKED';
        payload.state_locking = 'LOCKING';
        payload.state_unlocking = 'UNLOCKING';
        payload.state_jammed = 'JAMMED';
        payload.payload_lock = 'LOCK';
        payload.payload_unlock = 'UNLOCK';
        payload.value_template = '{{ value_json.state }}';
        break;

      case 'number':
        // Number entity configuration
        payload.command_topic = `${this.mqttTopicPrefix}/${id}/set`;
        payload.state_topic = `${this.mqttTopicPrefix}/${id}/state`;
        payload.value_template = '{{ value_json.value }}';

        // Set min, max, step from entity config
        if (entity.min_value !== undefined) {
          payload.min = entity.min_value;
        }
        if (entity.max_value !== undefined) {
          payload.max = entity.max_value;
        }
        if (entity.step !== undefined) {
          payload.step = entity.step;
        }

        // Default mode is slider, can be 'box' or 'slider'
        payload.mode = 'slider';
        break;

      case 'select':
        // Select entity configuration
        payload.command_topic = `${this.mqttTopicPrefix}/${id}/set`;
        payload.state_topic = `${this.mqttTopicPrefix}/${id}/state`;
        payload.value_template = '{{ value_json.option }}';

        // Options list is required for select
        if (entity.options && entity.options.length > 0) {
          payload.options = entity.options;
        } else {
          logger.warn(`[DiscoveryManager] Select entity ${id} has no options defined`);
          payload.options = [];
        }
        break;

      case 'fan':
        // Fan state extracted from JSON
        payload.state_topic = `${this.mqttTopicPrefix}/${id}/state`;
        payload.state_value_template = '{{ value_json.state }}';
        payload.payload_on = 'ON';
        payload.payload_off = 'OFF';

        // Percentage/Speed support (1-100)
        if (entity.state_percentage || entity.state_speed) {
          payload.percentage_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.percentage_command_topic = `${this.mqttTopicPrefix}/${id}/percentage/set`;
          payload.percentage_value_template =
            '{{ value_json.percentage | default(value_json.speed) }}';
          payload.speed_range_min = 1;
          payload.speed_range_max = 100;
        }

        // Preset modes support
        if (entity.preset_modes && entity.preset_modes.length > 0) {
          payload.preset_modes = entity.preset_modes;
          payload.preset_mode_command_topic = `${this.mqttTopicPrefix}/${id}/preset/set`;
          payload.preset_mode_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.preset_mode_value_template = '{{ value_json.preset_mode }}';
        }

        // Oscillation support
        if (entity.state_oscillating || entity.command_oscillating) {
          payload.oscillation_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.oscillation_command_topic = `${this.mqttTopicPrefix}/${id}/oscillation/set`;
          payload.oscillation_value_template = '{{ value_json.oscillating }}';
        }

        // Direction support
        if (entity.state_direction || entity.command_direction) {
          payload.direction_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.direction_command_topic = `${this.mqttTopicPrefix}/${id}/direction/set`;
          payload.direction_value_template = '{{ value_json.direction }}';
        }
        break;

      case 'valve':
        // Valve state - Home Assistant expects specific state values
        payload.state_topic = `${this.mqttTopicPrefix}/${id}/state`;
        payload.value_template = '{{ value_json.state }}';
        payload.command_topic = `${this.mqttTopicPrefix}/${id}/set`;

        // State values that HA expects (matching actual state values in uppercase)
        payload.state_open = 'OPEN';
        payload.state_opening = 'OPENING';
        payload.state_closed = 'CLOSED';
        payload.state_closing = 'CLOSING';

        // Command payloads
        payload.payload_open = 'OPEN';
        payload.payload_close = 'CLOSE';

        // Stop command support
        if (entity.command_stop) {
          payload.payload_stop = 'STOP';
        }

        // Position support (0-100%)
        if (entity.state_position || entity.command_position) {
          payload.position_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.set_position_topic = `${this.mqttTopicPrefix}/${id}/position/set`;
          payload.position_template = '{{ value_json.position }}';
          payload.position_open = 100;
          payload.position_closed = 0;
        }

        // Reports position flag
        if (entity.reports_position !== undefined) {
          payload.reports_position = entity.reports_position;
        }
        break;

      case 'sensor':
        // Sensors are read-only, no command_topic
        // Extract value from JSON state
        if (!payload.value_template) {
          payload.value_template = '{{ value_json.value }}';
        }
        break;

      case 'binary_sensor':
        // Binary sensors are read-only, return true/false or ON/OFF
        payload.value_template = '{{ value_json.state }}';
        // Optionally set payload_on/off if needed
        if (entity.payload_on) {
          payload.payload_on = entity.payload_on;
        }
        if (entity.payload_off) {
          payload.payload_off = entity.payload_off;
        }
        break;

      case 'climate':
        // Climate entities use separate command topics but single state topic with templates
        payload.mode_command_topic = `${this.mqttTopicPrefix}/${id}/mode/set`;
        payload.temperature_command_topic = `${this.mqttTopicPrefix}/${id}/temperature/set`;

        // Use single state_topic with templates to extract values from JSON
        payload.mode_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
        payload.mode_state_template = '{{ value_json.mode }}';

        payload.temperature_state_topic = `${this.mqttTopicPrefix}/${id}/state`;
        payload.temperature_state_template = '{{ value_json.target_temperature }}';

        payload.current_temperature_topic = `${this.mqttTopicPrefix}/${id}/state`;
        payload.current_temperature_template = '{{ value_json.current_temperature }}';

        // Only include action template if the entity has state_action configured
        if (entity.state_action) {
          payload.action_topic = `${this.mqttTopicPrefix}/${id}/state`;
          payload.action_template = '{{ value_json.action }}';
        }

        // Dynamically determine available modes
        const availableModes: string[] = [];
        if (entity.state_off) {
          availableModes.push('off');
        }
        if (entity.state_heat) {
          availableModes.push('heat');
        }
        if (entity.state_cool) {
          availableModes.push('cool');
        }
        if (entity.state_fan_only) {
          availableModes.push('fan_only');
        }
        if (entity.state_dry) {
          availableModes.push('dry');
        }
        if (entity.state_auto) {
          // Assuming 'state_auto' property for auto mode
          availableModes.push('auto');
        }
        payload.modes = availableModes;

        payload.temperature_unit = 'C';
        payload.min_temp = 15;
        payload.max_temp = 30;
        payload.temp_step = 1;
        break;
      case 'button':
        payload.payload_press = 'PRESS';
        break;
      case 'text_sensor':
        // Text sensor is read-only
        payload.value_template = '{{ value_json.text }}';
        break;
      case 'text':
        // Text entity with input
        payload.command_topic = `${this.mqttTopicPrefix}/${id}/set`;
        payload.state_topic = `${this.mqttTopicPrefix}/${id}/state`;
        payload.value_template = '{{ value_json.text }}';

        // Set min, max length from entity config
        if (entity.min_length !== undefined) {
          payload.min = entity.min_length;
        }
        if (entity.max_length !== undefined) {
          payload.max = entity.max_length;
        }
        if (entity.pattern !== undefined) {
          payload.pattern = entity.pattern;
        }
        if (entity.mode !== undefined) {
          payload.mode = entity.mode; // 'text' or 'password'
        }
        break;
    }

    this.publisher.publish(topic, JSON.stringify(payload), { retain: true });
    logger.debug({ topic, uniqueId }, '[DiscoveryManager] Published discovery config');
  }
}
