import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class ClimateDevice extends GenericDevice {
  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: number[]): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as any;

    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    // Handle temperature extraction if not handled by lambda
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

    return Object.keys(updates).length > 0 ? updates : null;
  }

  public constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | null {
    const cmd = super.constructCommand(commandName, value, states);
    if (cmd) return cmd;

    const entityConfig = this.config as any;
    if (commandName === 'off' && entityConfig.command_off?.data) {
      return [...entityConfig.command_off.data];
    }
    if (commandName === 'heat' && entityConfig.command_heat?.data) {
      return [...entityConfig.command_heat.data];
    }

    // Handle temperature command with value_offset schema (uses shared insertValueIntoCommand)
    if (commandName === 'temperature' && entityConfig.command_temperature?.data && value !== undefined) {
      return this.insertValueIntoCommand(entityConfig.command_temperature, value);
    }

    // Handle humidity command with value_offset schema
    if (commandName === 'humidity' && entityConfig.command_humidity?.data && value !== undefined) {
      return this.insertValueIntoCommand(entityConfig.command_humidity, value);
    }

    return null;
  }
}
