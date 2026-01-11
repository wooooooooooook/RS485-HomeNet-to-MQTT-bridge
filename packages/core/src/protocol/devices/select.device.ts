import { GenericDevice } from './generic.device.js';
import { ProtocolConfig, CommandResult } from '../types.js';
import { SelectEntity } from '../../domain/entities/select.entity.js';
import { normalizeDeviceState } from './state-normalizer.js';

export class SelectDevice extends GenericDevice {
  constructor(config: SelectEntity, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: Buffer): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }

    const updates = super.parseData(packet) || {};
    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    const normalized = normalizeDeviceState({ ...this.config, type: 'select' } as SelectEntity, payload, updates, {
      headerLen: headerLength,
      state: this.getState(),
    });

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  public constructCommand(commandName: string, value?: any): number[] | CommandResult | null {
    const entityConfig = this.config as SelectEntity;

    // Handle select command with option value
    // Check if it's NOT a CEL (GenericDevice handles CELs)
    if (
      commandName === 'select' &&
      (entityConfig.command_select as any)?.data &&
      value !== undefined
    ) {
      const command = [...(entityConfig.command_select as any).data];
      const commandSchema = entityConfig.command_select as any;

      if (commandSchema.map && commandSchema.map[value] !== undefined) {
        const mappedValue = commandSchema.map[value];
        const valueOffset = commandSchema.value_offset;

        if (valueOffset !== undefined) {
          // Insert mapped value
          // Assuming 1 byte for now unless length specified
          command[valueOffset] = mappedValue;
        }
      }

      return command;
    }

    return super.constructCommand(commandName, value);
  }
}
