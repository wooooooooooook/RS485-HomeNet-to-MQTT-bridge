import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig, CommandResult } from '../types.js';
import { ValveEntity } from '../../domain/entities/valve.entity.js';
import { normalizeDeviceState } from './state-normalizer.js';

export class ValveDevice extends GenericDevice {
  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: Buffer): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    const updates = super.parseData(packet) || {};
    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const normalized = normalizeDeviceState(
      { ...this.config, type: 'valve' } as ValveEntity,
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
    const entityConfig = this.config as ValveEntity;
    const commandConfig = (entityConfig as any)[`command_${commandName}`];

    // If CEL string, let GenericDevice handle it
    if (typeof commandConfig === 'string') {
      return super.constructCommand(commandName, value, states);
    }

    // Handle position command (0-100%)
    if (
      commandName === 'position' &&
      typeof entityConfig.command_position !== 'string' &&
      entityConfig.command_position?.data &&
      value !== undefined
    ) {
      const command = [...entityConfig.command_position.data];
      const valueOffset = (entityConfig.command_position as any).value_offset;
      if (valueOffset !== undefined) {
        const position = Math.min(100, Math.max(0, Math.round(value)));
        command[valueOffset] = position;
      }
      return this.framePacket(command);
    }

    // Fallback to GenericDevice for any other command_* that has data defined
    return super.constructCommand(commandName, value, states);
  }
}
