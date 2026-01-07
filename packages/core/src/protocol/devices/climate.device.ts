import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig, CommandResult } from '../types.js';

export class ClimateDevice extends GenericDevice {
  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: Buffer): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as any;

    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    // Handle temperature extraction if not handled by CEL
    if (!updates.current_temperature && entityConfig.state_temperature_current) {
      const val = this.extractValue(payload, entityConfig.state_temperature_current);
      if (val !== null) updates.current_temperature = val;
    }

    if (!updates.target_temperature && entityConfig.state_temperature_target) {
      const val = this.extractValue(payload, entityConfig.state_temperature_target);
      if (val !== null) updates.target_temperature = val;
    }

    // Handle mode
    if (!updates.mode) {
      if (this.matchState(payload, entityConfig.state_off)) {
        updates.mode = 'off';
      } else if (this.matchState(payload, entityConfig.state_heat)) {
        updates.mode = 'heat';
      } else if (this.matchState(payload, entityConfig.state_cool)) {
        updates.mode = 'cool';
      }
    }

    // Handle action
    // Priority: heating/cooling > idle > off (though off usually implies idle or off action)
    if (!updates.action) {
      if (this.matchState(payload, entityConfig.state_action_heating)) {
        updates.action = 'heating';
      } else if (this.matchState(payload, entityConfig.state_action_cooling)) {
        updates.action = 'cooling';
      } else if (this.matchState(payload, entityConfig.state_action_drying)) {
        updates.action = 'drying';
      } else if (this.matchState(payload, entityConfig.state_action_fan)) {
        updates.action = 'fan';
      } else if (this.matchState(payload, entityConfig.state_action_idle)) {
        updates.action = 'idle';
      } else if (updates.mode === 'off') {
        updates.action = 'off';
      }
    }

    if (!updates.fan_mode) {
      const fanModeMappings: Array<[keyof typeof entityConfig, string]> = [
        ['state_fan_on', 'on'],
        ['state_fan_off', 'off'],
        ['state_fan_auto', 'auto'],
        ['state_fan_low', 'low'],
        ['state_fan_medium', 'medium'],
        ['state_fan_high', 'high'],
        ['state_fan_middle', 'middle'],
        ['state_fan_focus', 'focus'],
        ['state_fan_diffuse', 'diffuse'],
        ['state_fan_quiet', 'quiet'],
      ];

      for (const [key, mode] of fanModeMappings) {
        if (this.matchState(payload, entityConfig[key])) {
          updates.fan_mode = mode;
          break;
        }
      }
    }

    if (!updates.preset_mode) {
      const presetModeMappings: Array<[keyof typeof entityConfig, string]> = [
        ['state_preset_none', 'none'],
        ['state_preset_home', 'home'],
        ['state_preset_away', 'away'],
        ['state_preset_boost', 'boost'],
        ['state_preset_comfort', 'comfort'],
        ['state_preset_eco', 'eco'],
        ['state_preset_sleep', 'sleep'],
        ['state_preset_activity', 'activity'],
      ];

      for (const [key, mode] of presetModeMappings) {
        if (this.matchState(payload, entityConfig[key])) {
          updates.preset_mode = mode;
          break;
        }
      }
    }

    if (!updates.fan_mode && updates.custom_fan) {
      updates.fan_mode = updates.custom_fan;
    }

    if (!updates.preset_mode && updates.custom_preset) {
      updates.preset_mode = updates.custom_preset;
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  public constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | CommandResult | null {
    const entityConfig = this.config as any;
    const normalizedCommandName = commandName.startsWith('command_')
      ? commandName
      : `command_${commandName}`;
    const commandConfig = entityConfig[normalizedCommandName];

    // 1. If it's a script (string), let GenericDevice (super) handle it.
    if (typeof commandConfig === 'string') {
      return super.constructCommand(commandName, value, states);
    }

    // 2. Handle specific value injection for temperature/humidity (overrides static data)
    if (value !== undefined) {
      if (
        commandName === 'temperature' &&
        commandConfig?.value_offset !== undefined &&
        commandConfig?.data
      ) {
        const data = this.insertValueIntoCommand(commandConfig, value);
        return data ? this.framePacket(data) : null;
      }
      if (
        commandName === 'humidity' &&
        commandConfig?.value_offset !== undefined &&
        commandConfig?.data
      ) {
        const data = this.insertValueIntoCommand(commandConfig, value);
        return data ? this.framePacket(data) : null;
      }
    }

    // 3. Fallback to GenericDevice for everything else (static data, simple scripts if any)
    return super.constructCommand(commandName, value, states);
  }
}
