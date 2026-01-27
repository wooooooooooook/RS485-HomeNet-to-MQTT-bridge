import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig, CommandResult } from '../types.js';
import { LightEntity } from '../../domain/entities/light.entity.js';
import { normalizeDeviceState } from './state-normalizer.js';

export class LightDevice extends GenericDevice {
  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: Buffer): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    // First try CEL parsing from GenericDevice
    const updates = super.parseData(packet) || {};
    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const normalized = normalizeDeviceState(
      { ...this.config, type: 'light' } as LightEntity,
      packet,
      updates,
      {
        headerLen: headerLength,
        state: this.getState(),
      },
    );

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  public constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | CommandResult | null {
    const entityConfig = this.config as LightEntity;
    const commandConfig = (entityConfig as any)[`command_${commandName}`];

    // If CEL string, let GenericDevice handle it
    if (typeof commandConfig === 'string') {
      return super.constructCommand(commandName, value, states);
    }

    // Handle brightness command
    if (
      commandName === 'brightness' &&
      typeof entityConfig.command_brightness !== 'string' &&
      entityConfig.command_brightness?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_brightness.data];
      const valueOffset = (entityConfig.command_brightness as any).value_offset;
      if (valueOffset !== undefined) {
        command[valueOffset] = Math.round(value);
      }
      return this.framePacket(command);
    }

    // Handle color temperature command
    if (
      commandName === 'color_temp' &&
      typeof entityConfig.command_color_temp !== 'string' &&
      entityConfig.command_color_temp?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_color_temp.data];
      const valueOffset = (entityConfig.command_color_temp as any).value_offset;
      const length = (entityConfig.command_color_temp as any).length || 2;
      if (valueOffset !== undefined) {
        const val = Math.round(value);
        if (length === 2) {
          command[valueOffset] = (val >> 8) & 0xff;
          command[valueOffset + 1] = val & 0xff;
        } else {
          command[valueOffset] = val;
        }
      }
      return this.framePacket(command);
    }

    // Handle RGB commands
    if (
      commandName === 'red' &&
      typeof entityConfig.command_red !== 'string' &&
      entityConfig.command_red?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_red.data];
      const valueOffset = (entityConfig.command_red as any).value_offset;
      if (valueOffset !== undefined) {
        command[valueOffset] = Math.round(value);
      }
      return this.framePacket(command);
    }
    if (
      commandName === 'green' &&
      typeof entityConfig.command_green !== 'string' &&
      entityConfig.command_green?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_green.data];
      const valueOffset = (entityConfig.command_green as any).value_offset;
      if (valueOffset !== undefined) {
        command[valueOffset] = Math.round(value);
      }
      return this.framePacket(command);
    }
    if (
      commandName === 'blue' &&
      typeof entityConfig.command_blue !== 'string' &&
      entityConfig.command_blue?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_blue.data];
      const valueOffset = (entityConfig.command_blue as any).value_offset;
      if (valueOffset !== undefined) {
        command[valueOffset] = Math.round(value);
      }
      return this.framePacket(command);
    }

    // Handle white value command
    if (
      commandName === 'white' &&
      typeof entityConfig.command_white !== 'string' &&
      entityConfig.command_white?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_white.data];
      const valueOffset = (entityConfig.command_white as any).value_offset;
      if (valueOffset !== undefined) {
        command[valueOffset] = Math.round(value);
      }
      return this.framePacket(command);
    }

    // Fallback to GenericDevice for any other command_* that has data defined
    return super.constructCommand(commandName, value, states);
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
