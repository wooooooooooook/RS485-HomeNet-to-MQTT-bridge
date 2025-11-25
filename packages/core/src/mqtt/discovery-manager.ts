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
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: string;
  icon?: string;
  value_template?: string;
  payload_on?: string;
  payload_off?: string;
  state_on?: string;
  state_off?: string;
  [key: string]: any;
}

export class DiscoveryManager {
  private config: HomenetBridgeConfig;
  private publisher: MqttPublisher;
  private subscriber: MqttSubscriber;
  private readonly discoveryPrefix = 'homeassistant';
  private readonly bridgeStatusTopic = 'homenet/bridge/status';

  constructor(config: HomenetBridgeConfig, publisher: MqttPublisher, subscriber: MqttSubscriber) {
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
      ...(this.config.lock || []).map((e) => ({ ...e, type: 'lock' })),
      ...(this.config.number || []).map((e) => ({ ...e, type: 'number' })),
      ...(this.config.select || []).map((e) => ({ ...e, type: 'select' })),
      ...(this.config.text_sensor || []).map((e) => ({ ...e, type: 'text_sensor' })),
      ...(this.config.text || []).map((e) => ({ ...e, type: 'text' })),
      ...(this.config.binary_sensor || []).map((e) => ({ ...e, type: 'binary_sensor' })),
    ];

    for (const entity of entities) {
      this.publishDiscovery(entity);
    }
  }

  private publishDiscovery(entity: any): void {
    const {
      id,
      name,
      type,
      device_class,
      unit_of_measurement,
      state_class,
      icon,
      // Filter out internal configuration objects that should not be in discovery
      state,
      state_on,
      state_off,
      state_speed,
      state_preset,
      state_number,
      command_on,
      command_off,
      command_speed,
      command_preset,
      command_update,
      command_mode,
      command_temperature,
      command_number,
      state_mode,
      state_temperature,
      state_current_temperature,
      state_action,
      ...rest
    } = entity;

    if (!id) {
      logger.error({ entity }, '[DiscoveryManager] Entity missing ID, skipping discovery');
      return;
    }

    const uniqueId = `homenet_${id}`;
    const topic = `${this.discoveryPrefix}/${type}/${uniqueId}/config`;

    logger.debug({ id, uniqueId, topic }, '[DiscoveryManager] Preparing discovery');

    const payload: DiscoveryPayload = {
      name: name || null,
      unique_id: uniqueId,
      state_topic: `homenet/${id}/state`,
      availability: [{ topic: this.bridgeStatusTopic }],
      device: {
        identifiers: ['homenet_bridge_device'],
        name: 'Homenet Bridge',
        manufacturer: 'RS485 Bridge',
        model: 'Bridge',
      },
      device_class,
      unit_of_measurement,
      state_class,
      icon,
      ...rest,
    };

    if (['light', 'switch', 'fan', 'button', 'lock', 'number', 'select'].includes(type)) {
      payload.command_topic = `homenet/${id}/set`;
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
          payload.brightness_state_topic = `homenet/${id}/state`;
          payload.brightness_command_topic = `homenet/${id}/brightness/set`;
          payload.brightness_scale = 255;
          payload.brightness_value_template = '{{ value_json.brightness }}';
        }

        // RGB color support
        if (entity.state_red || entity.state_green || entity.state_blue) {
          payload.rgb_state_topic = `homenet/${id}/state`;
          payload.rgb_command_topic = `homenet/${id}/rgb/set`;
          payload.rgb_value_template =
            '{{ value_json.red }},{{ value_json.green }},{{ value_json.blue }}';
        }

        // Color temperature support (mireds)
        if (entity.state_color_temp || entity.command_color_temp) {
          payload.color_temp_state_topic = `homenet/${id}/state`;
          payload.color_temp_command_topic = `homenet/${id}/color_temp/set`;
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
          payload.effect_state_topic = `homenet/${id}/state`;
          payload.effect_command_topic = `homenet/${id}/effect/set`;
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
        payload.command_topic = `homenet/${id}/set`;
        payload.state_topic = `homenet/${id}/state`;
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
        payload.command_topic = `homenet/${id}/set`;
        payload.state_topic = `homenet/${id}/state`;
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
        // Extract state from JSON
        payload.value_template = '{{ value_json.state }}';
        payload.payload_on = 'ON';
        payload.payload_off = 'OFF';

        // Percentage/Speed support (1-100)
        if (entity.state_percentage || entity.state_speed) {
          payload.percentage_state_topic = `homenet/${id}/state`;
          payload.percentage_command_topic = `homenet/${id}/percentage/set`;
          payload.percentage_value_template =
            '{{ value_json.percentage | default(value_json.speed) }}';
          payload.speed_range_min = 1;
          payload.speed_range_max = 100;
        }

        // Preset modes support
        if (entity.preset_modes && entity.preset_modes.length > 0) {
          payload.preset_modes = entity.preset_modes;
          payload.preset_mode_command_topic = `homenet/${id}/preset/set`;
          payload.preset_mode_state_topic = `homenet/${id}/state`;
          payload.preset_mode_value_template = '{{ value_json.preset_mode }}';
        }

        // Oscillation support
        if (entity.state_oscillating || entity.command_oscillating) {
          payload.oscillation_state_topic = `homenet/${id}/state`;
          payload.oscillation_command_topic = `homenet/${id}/oscillation/set`;
          payload.oscillation_value_template = '{{ value_json.oscillating }}';
        }

        // Direction support
        if (entity.state_direction || entity.command_direction) {
          payload.direction_state_topic = `homenet/${id}/state`;
          payload.direction_command_topic = `homenet/${id}/direction/set`;
          payload.direction_value_template = '{{ value_json.direction }}';
        }
        break;

      case 'valve':
        // Valve state
        payload.value_template = '{{ value_json.state }}';
        payload.command_topic = `homenet/${id}/set`;

        // Basic commands
        payload.payload_open = 'OPEN';
        payload.payload_close = 'CLOSE';

        // Stop command support
        if (entity.command_stop) {
          payload.payload_stop = 'STOP';
        }

        // Position support (0-100%)
        if (entity.state_position || entity.command_position) {
          payload.position_topic = `homenet/${id}/state`;
          payload.set_position_topic = `homenet/${id}/position/set`;
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
      case 'climate':
        // Climate entities use separate command topics but single state topic with templates
        payload.mode_command_topic = `homenet/${id}/mode/set`;
        payload.temperature_command_topic = `homenet/${id}/temperature/set`;

        // Use single state_topic with templates to extract values from JSON
        payload.mode_state_topic = `homenet/${id}/state`;
        payload.mode_state_template = '{{ value_json.mode }}';

        payload.temperature_state_topic = `homenet/${id}/state`;
        payload.temperature_state_template = '{{ value_json.target_temperature }}';

        payload.current_temperature_topic = `homenet/${id}/state`;
        payload.current_temperature_template = '{{ value_json.current_temperature }}';

        // Only include action template if the entity has state_action configured
        if (entity.state_action) {
          payload.action_topic = `homenet/${id}/state`;
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
        if (entity.state_auto) { // Assuming 'state_auto' property for auto mode
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
        payload.command_topic = `homenet/${id}/set`;
        payload.state_topic = `homenet/${id}/state`;
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
