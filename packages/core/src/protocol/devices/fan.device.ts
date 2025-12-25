import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';
import { FanEntity } from '../../domain/entities/fan.entity.js';

export class FanDevice extends GenericDevice {
  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: number[]): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as FanEntity;

    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    // Handle on/off if not CEL
    if (!updates.state) {
      if (entityConfig.state_on && this.matchState(payload, entityConfig.state_on)) {
        updates.state = 'ON';
      } else if (entityConfig.state_off && this.matchState(payload, entityConfig.state_off)) {
        updates.state = 'OFF';
      }
    }

    // Handle speed
    if (!updates.speed && entityConfig.state_speed) {
      const val = this.extractValue(payload, entityConfig.state_speed);
      if (val !== null) updates.speed = val;
    }

    // Handle percentage
    if (!updates.percentage && entityConfig.state_percentage) {
      const val = this.extractValue(payload, entityConfig.state_percentage);
      if (val !== null) updates.percentage = val;
    }

    // Handle oscillation
    if (!updates.oscillating && entityConfig.state_oscillating) {
      if (
        entityConfig.state_oscillating &&
        this.matchState(payload, entityConfig.state_oscillating)
      ) {
        updates.oscillating = true;
      }
    }

    // Handle direction
    if (!updates.direction && entityConfig.state_direction) {
      if (entityConfig.state_direction && this.matchState(payload, entityConfig.state_direction)) {
        const offset = entityConfig.state_direction.offset || 0;
        if (payload[offset] === 0) {
          updates.direction = 'forward';
        } else {
          updates.direction = 'reverse';
        }
      }
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  public constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | null {
    const entityConfig = this.config as FanEntity;
    const commandConfig = (entityConfig as any)[`command_${commandName}`];

    // If CEL string, let GenericDevice handle it
    if (typeof commandConfig === 'string') {
      return super.constructCommand(commandName, value, states);
    }

    if (commandName === 'on' && entityConfig.command_on?.data) {
      return super.constructCommand(commandName, value, states);
    }
    if (commandName === 'off' && entityConfig.command_off?.data) {
      return super.constructCommand(commandName, value, states);
    }

    // Handle speed command
    if (commandName === 'speed' && entityConfig.command_speed?.data && value !== undefined) {
      const command = [...entityConfig.command_speed.data];
      const valueOffset = (entityConfig.command_speed as any).value_offset;
      if (valueOffset !== undefined) {
        command[valueOffset] = Math.round(value);
      }
      return this.framePacket(command);
    }

    // Handle percentage command
    if (
      commandName === 'percentage' &&
      entityConfig.command_percentage?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_percentage.data];
      const valueOffset = (entityConfig.command_percentage as any).value_offset;
      if (valueOffset !== undefined) {
        command[valueOffset] = Math.round(value);
      }
      return this.framePacket(command);
    }

    // Handle preset mode command
    if (
      commandName === 'preset_mode' &&
      entityConfig.command_preset_mode?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_preset_mode.data];
      // Value would be preset name, needs mapping to byte value
      return this.framePacket(command);
    }

    // Handle oscillation command
    if (
      commandName === 'oscillating' &&
      entityConfig.command_oscillating?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_oscillating.data];
      const valueOffset = (entityConfig.command_oscillating as any).value_offset;
      if (valueOffset !== undefined) {
        command[valueOffset] = value ? 1 : 0;
      }
      return this.framePacket(command);
    }

    // Handle direction command
    if (
      commandName === 'direction' &&
      entityConfig.command_direction?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_direction.data];
      const valueOffset = (entityConfig.command_direction as any).value_offset;
      if (valueOffset !== undefined) {
        command[valueOffset] = value === 'forward' ? 0 : 1;
      }
      return this.framePacket(command);
    }

    return null;
  }
}
