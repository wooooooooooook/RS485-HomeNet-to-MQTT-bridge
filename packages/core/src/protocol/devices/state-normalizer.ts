import { matchesPacket } from '../../utils/packet-matching.js';
import { StateSchema, StateNumSchema } from '../types.js';

export interface NormalizeStateOptions {
  headerLen?: number;
  state?: Record<string, any>;
}

const matchesState = (
  payload: Uint8Array,
  schema: StateSchema | undefined,
  options: NormalizeStateOptions,
): boolean => {
  if (!schema) return false;
  const headerLen = options.headerLen ?? 0;
  const baseOffset = schema.offset === undefined ? headerLen : 0;
  return matchesPacket(schema, payload, {
    baseOffset,
    allowEmptyData: true,
    context: { state: options.state ?? {} },
  });
};

const matchesSchemaWithHeader = (
  payload: Uint8Array,
  schema: StateSchema | undefined,
  options: NormalizeStateOptions,
): boolean => {
  if (!schema) return false;
  const headerLen = options.headerLen ?? 0;
  return matchesPacket(schema, payload, {
    baseOffset: headerLen,
    context: { state: options.state ?? {} },
  });
};

const extractValue = (bytes: Uint8Array, schema: StateNumSchema): number | string | null => {
  const {
    offset,
    length = 1,
    precision = 0,
    signed = false,
    endian = 'big',
    decode = 'none',
  } = schema;

  if (offset === undefined || offset + length > bytes.length) {
    return null;
  }

  const valueBytes: number[] = [];
  if (endian === 'little') {
    for (let i = offset + length - 1; i >= offset; i -= 1) {
      valueBytes.push(bytes[i]);
    }
  } else {
    for (let i = offset; i < offset + length; i += 1) {
      valueBytes.push(bytes[i]);
    }
  }

  let value: number | string = 0;
  if (decode === 'ascii') {
    value = String.fromCharCode(...valueBytes);
    return value;
  }
  if (decode === 'bcd') {
    let bcdVal = 0;
    for (const b of valueBytes) {
      bcdVal = bcdVal * 100 + (b >> 4) * 10 + (b & 0x0f);
    }
    value = bcdVal;
  } else if (decode === 'signed_byte_half_degree') {
    const b = valueBytes[0];
    let val = b & 0x7f;
    if ((b & 0x80) !== 0) {
      val += 0.5;
    }
    if (signed && (b & 0x40) !== 0) {
      val = -val;
    }
    value = val;
  } else {
    let intVal = 0;
    for (const b of valueBytes) {
      intVal = intVal * 256 + b;
    }
    value = intVal;
  }

  if (typeof value === 'number' && signed && decode === 'none') {
    const bitLen = length * 8;
    const maxUnsigned = Math.pow(2, bitLen);
    if (value >= maxUnsigned / 2) {
      value = value - maxUnsigned;
    }
  }

  if (typeof value === 'number' && precision > 0) {
    value = parseFloat((value / Math.pow(10, precision)).toFixed(precision));
  }

  if (typeof value === 'number' && schema.mapping) {
    if (value in schema.mapping) {
      return schema.mapping[value];
    }
  }

  return value;
};

const extractOption = (payload: Uint8Array, schema: any): string | null => {
  if (!schema || !schema.map) return null;

  const offset = schema.offset || 0;
  const length = schema.length || 1;

  if (payload.length < offset + length) return null;

  let value = 0;
  if (length === 1) {
    value = payload[offset];
  } else {
    for (let i = 0; i < length; i += 1) {
      value = (value << 8) | payload[offset + i];
    }
  }

  if (schema.map[value]) {
    return schema.map[value];
  }

  return null;
};

const cleanupBoolean = (updates: Record<string, any>, cleanupKeys: Set<string>, key: string) => {
  if (typeof updates[key] === 'boolean') {
    cleanupKeys.add(key);
  }
};

const resolveFlag = (
  updates: Record<string, any>,
  cleanupKeys: Set<string>,
  key: string,
  schema: StateSchema | undefined,
  payload: Uint8Array,
  options: NormalizeStateOptions,
): boolean | undefined => {
  if (typeof updates[key] === 'boolean') {
    cleanupKeys.add(key);
    if (updates[key]) {
      return true;
    }
  }
  if (schema && matchesState(payload, schema, options)) {
    return true;
  }
  return undefined;
};

export const normalizeDeviceState = (
  entityConfig: Record<string, any>,
  payload: Uint8Array,
  updates: Record<string, any>,
  options: NormalizeStateOptions = {},
): Record<string, any> => {
  const normalized = { ...updates };
  const cleanupKeys = new Set<string>();
  const entityType = entityConfig.type;

  const applyOnOffState = () => {
    const on = resolveFlag(
      normalized,
      cleanupKeys,
      'on',
      entityConfig.state_on,
      payload,
      options,
    );
    const off = resolveFlag(
      normalized,
      cleanupKeys,
      'off',
      entityConfig.state_off,
      payload,
      options,
    );
    if (!normalized.state) {
      if (on) {
        normalized.state = 'ON';
      } else if (off) {
        normalized.state = 'OFF';
      }
    }
  };

  if (entityType === 'binary_sensor' || entityType === 'switch' || entityType === 'light') {
    applyOnOffState();
  }

  if (entityType === 'light') {
    if (!normalized.brightness && entityConfig.state_brightness) {
      const brightness = extractValue(payload, entityConfig.state_brightness);
      if (brightness !== null) {
        normalized.brightness = brightness;
      }
    }

    if (!normalized.color_temp && entityConfig.state_color_temp) {
      const colorTemp = extractValue(payload, entityConfig.state_color_temp);
      if (colorTemp !== null) {
        normalized.color_temp = colorTemp;
      }
    }

    if (!normalized.red && entityConfig.state_red) {
      const red = extractValue(payload, entityConfig.state_red);
      if (red !== null) normalized.red = red;
    }
    if (!normalized.green && entityConfig.state_green) {
      const green = extractValue(payload, entityConfig.state_green);
      if (green !== null) normalized.green = green;
    }
    if (!normalized.blue && entityConfig.state_blue) {
      const blue = extractValue(payload, entityConfig.state_blue);
      if (blue !== null) normalized.blue = blue;
    }

    if (!normalized.white && entityConfig.state_white) {
      const white = extractValue(payload, entityConfig.state_white);
      if (white !== null) {
        normalized.white = white;
      }
    }
  }

  if (entityType === 'fan') {
    applyOnOffState();

    if (!normalized.speed && entityConfig.state_speed) {
      const val = extractValue(payload, entityConfig.state_speed);
      if (val !== null) normalized.speed = val;
    }

    if (!normalized.percentage && entityConfig.state_percentage) {
      const val = extractValue(payload, entityConfig.state_percentage);
      if (val !== null) normalized.percentage = val;
    }

    const oscillating = resolveFlag(
      normalized,
      cleanupKeys,
      'oscillating',
      entityConfig.state_oscillating,
      payload,
      options,
    );
    if (oscillating) {
      normalized.oscillating = true;
      cleanupKeys.delete('oscillating');
    }

    const directionFlag = resolveFlag(
      normalized,
      cleanupKeys,
      'direction',
      entityConfig.state_direction,
      payload,
      options,
    );
    if (directionFlag && entityConfig.state_direction) {
      const offset = entityConfig.state_direction.offset || 0;
      if (payload[offset] === 0) {
        normalized.direction = 'forward';
      } else {
        normalized.direction = 'reverse';
      }
      cleanupKeys.delete('direction');
    }
  }

  if (entityType === 'climate') {
    if (!normalized.current_temperature && entityConfig.state_temperature_current) {
      const val = extractValue(payload, entityConfig.state_temperature_current);
      if (val !== null) normalized.current_temperature = val;
    }

    if (!normalized.target_temperature && entityConfig.state_temperature_target) {
      const val = extractValue(payload, entityConfig.state_temperature_target);
      if (val !== null) normalized.target_temperature = val;
    }

    if (!normalized.mode) {
      const off = resolveFlag(
        normalized,
        cleanupKeys,
        'off',
        entityConfig.state_off,
        payload,
        options,
      );
      const heat = resolveFlag(
        normalized,
        cleanupKeys,
        'heat',
        entityConfig.state_heat,
        payload,
        options,
      );
      const cool = resolveFlag(
        normalized,
        cleanupKeys,
        'cool',
        entityConfig.state_cool,
        payload,
        options,
      );
      if (off) {
        normalized.mode = 'off';
      } else if (heat) {
        normalized.mode = 'heat';
      } else if (cool) {
        normalized.mode = 'cool';
      }
    }

    if (!normalized.action) {
      const actionMappings: Array<[string, string, StateSchema | undefined]> = [
        ['action_heating', 'heating', entityConfig.state_action_heating],
        ['action_cooling', 'cooling', entityConfig.state_action_cooling],
        ['action_drying', 'drying', entityConfig.state_action_drying],
        ['action_fan', 'fan', entityConfig.state_action_fan],
        ['action_idle', 'idle', entityConfig.state_action_idle],
      ];
      for (const [key, value, schema] of actionMappings) {
        const matched = resolveFlag(normalized, cleanupKeys, key, schema, payload, options);
        if (matched) {
          normalized.action = value;
          break;
        }
      }
      if (!normalized.action && normalized.mode === 'off') {
        normalized.action = 'off';
      }
    }

    if (!normalized.fan_mode) {
      const fanModeMappings: Array<[string, string, StateSchema | undefined]> = [
        ['fan_on', 'on', entityConfig.state_fan_on],
        ['fan_off', 'off', entityConfig.state_fan_off],
        ['fan_auto', 'auto', entityConfig.state_fan_auto],
        ['fan_low', 'low', entityConfig.state_fan_low],
        ['fan_medium', 'medium', entityConfig.state_fan_medium],
        ['fan_high', 'high', entityConfig.state_fan_high],
        ['fan_middle', 'middle', entityConfig.state_fan_middle],
        ['fan_focus', 'focus', entityConfig.state_fan_focus],
        ['fan_diffuse', 'diffuse', entityConfig.state_fan_diffuse],
        ['fan_quiet', 'quiet', entityConfig.state_fan_quiet],
      ];

      for (const [key, mode, schema] of fanModeMappings) {
        const matched = resolveFlag(normalized, cleanupKeys, key, schema, payload, options);
        if (matched) {
          normalized.fan_mode = mode;
          break;
        }
      }
    }

    if (!normalized.preset_mode) {
      const presetModeMappings: Array<[string, string, StateSchema | undefined]> = [
        ['preset_none', 'none', entityConfig.state_preset_none],
        ['preset_home', 'home', entityConfig.state_preset_home],
        ['preset_away', 'away', entityConfig.state_preset_away],
        ['preset_boost', 'boost', entityConfig.state_preset_boost],
        ['preset_comfort', 'comfort', entityConfig.state_preset_comfort],
        ['preset_eco', 'eco', entityConfig.state_preset_eco],
        ['preset_sleep', 'sleep', entityConfig.state_preset_sleep],
        ['preset_activity', 'activity', entityConfig.state_preset_activity],
      ];

      for (const [key, mode, schema] of presetModeMappings) {
        const matched = resolveFlag(normalized, cleanupKeys, key, schema, payload, options);
        if (matched) {
          normalized.preset_mode = mode;
          break;
        }
      }
    }

    if (!normalized.fan_mode && normalized.custom_fan) {
      normalized.fan_mode = normalized.custom_fan;
    }

    if (!normalized.preset_mode && normalized.custom_preset) {
      normalized.preset_mode = normalized.custom_preset;
    }
  }

  if (entityType === 'valve') {
    if (!normalized.state) {
      const open = resolveFlag(
        normalized,
        cleanupKeys,
        'open',
        entityConfig.state_open,
        payload,
        options,
      );
      const closed = resolveFlag(
        normalized,
        cleanupKeys,
        'closed',
        entityConfig.state_closed,
        payload,
        options,
      );
      const opening = resolveFlag(
        normalized,
        cleanupKeys,
        'opening',
        entityConfig.state_opening,
        payload,
        options,
      );
      const closing = resolveFlag(
        normalized,
        cleanupKeys,
        'closing',
        entityConfig.state_closing,
        payload,
        options,
      );

      if (open) {
        normalized.state = 'OPEN';
      } else if (closed) {
        normalized.state = 'CLOSED';
      } else if (opening) {
        normalized.state = 'OPENING';
      } else if (closing) {
        normalized.state = 'CLOSING';
      }
    }

    if (!normalized.position && entityConfig.state_position) {
      const position = extractValue(payload, entityConfig.state_position);
      if (position !== null && typeof position === 'number') {
        normalized.position = Math.min(100, Math.max(0, position));
      }
    }
  }

  if (entityType === 'number' || entityType === 'sensor') {
    if (!normalized.value && typeof normalized.number !== 'undefined') {
      normalized.value = normalized.number;
      cleanupKeys.add('number');
    }

    if (!normalized.value && entityConfig.state_number) {
      const val = extractValue(payload, entityConfig.state_number);
      if (val !== null) {
        normalized.value = val;
      }
    }
  }

  if (entityType === 'number') {
    const increment = resolveFlag(
      normalized,
      cleanupKeys,
      'increment',
      entityConfig.state_increment,
      payload,
      options,
    );
    const decrement = resolveFlag(
      normalized,
      cleanupKeys,
      'decrement',
      entityConfig.state_decrement,
      payload,
      options,
    );
    const toMin = resolveFlag(
      normalized,
      cleanupKeys,
      'to_min',
      entityConfig.state_to_min,
      payload,
      options,
    );
    const toMax = resolveFlag(
      normalized,
      cleanupKeys,
      'to_max',
      entityConfig.state_to_max,
      payload,
      options,
    );

    if (increment) {
      normalized.action = 'increment';
    } else if (decrement) {
      normalized.action = 'decrement';
    } else if (toMin) {
      normalized.value = entityConfig.min_value;
    } else if (toMax) {
      normalized.value = entityConfig.max_value;
    }
  }

  if (entityType === 'select') {
    if (normalized.select && !normalized.option) {
      normalized.option = normalized.select;
    }

    if (!normalized.option && entityConfig.state_select) {
      const option = extractOption(payload, entityConfig.state_select);
      if (option) {
        normalized.option = option;
      }
    }
  }

  if (entityType === 'lock') {
    if (!normalized.state) {
      if (matchesSchemaWithHeader(payload, entityConfig.state_locked, options)) {
        normalized.state = 'LOCKED';
      } else if (matchesSchemaWithHeader(payload, entityConfig.state_unlocked, options)) {
        normalized.state = 'UNLOCKED';
      } else if (matchesSchemaWithHeader(payload, entityConfig.state_locking, options)) {
        normalized.state = 'LOCKING';
      } else if (matchesSchemaWithHeader(payload, entityConfig.state_unlocking, options)) {
        normalized.state = 'UNLOCKING';
      } else if (matchesSchemaWithHeader(payload, entityConfig.state_jammed, options)) {
        normalized.state = 'JAMMED';
      }
    }

    cleanupBoolean(normalized, cleanupKeys, 'locked');
    cleanupBoolean(normalized, cleanupKeys, 'unlocked');
    cleanupBoolean(normalized, cleanupKeys, 'locking');
    cleanupBoolean(normalized, cleanupKeys, 'unlocking');
    cleanupBoolean(normalized, cleanupKeys, 'jammed');
  }

  cleanupKeys.forEach((key) => {
    delete normalized[key];
  });

  return normalized;
};
