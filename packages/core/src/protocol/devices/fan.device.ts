import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig, CommandResult } from '../types.js';
import { FanEntity } from '../../domain/entities/fan.entity.js';
import { normalizeDeviceState } from './state-normalizer.js';

export class FanDevice extends GenericDevice {
  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: Buffer): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    const updates = super.parseData(packet) || {};
    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    const normalized = normalizeDeviceState({ ...this.config, type: 'fan' } as FanEntity, payload, updates, {
      headerLen: headerLength,
      state: this.getState(),
    });

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  public constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | CommandResult | null {
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

  public getOptimisticState(commandName: string, _value?: any): Record<string, any> | null {
    if (commandName === 'on') {
      return { state: 'ON' };
    }
    if (commandName === 'off') {
      return { state: 'OFF' };
    }
    return null;
  }
}
