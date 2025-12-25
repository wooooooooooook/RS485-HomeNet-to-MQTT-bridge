import { GenericDevice } from './generic.device.js';
import { ProtocolConfig } from '../types.js';
import { SelectEntity } from '../../domain/entities/select.entity.js';

export class SelectDevice extends GenericDevice {
  constructor(config: SelectEntity, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: number[]): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }

    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as SelectEntity;

    // If GenericDevice parsed state_select (as CEL), it puts it in updates.select.
    // We map it to updates.option which is what the Select entity expects.
    if (updates.select && !updates.option) {
      updates.option = updates.select;
    }

    // Parse selected option using state_select schema if not already parsed
    if (!updates.option && entityConfig.state_select) {
      const option = this.extractOption(packet, entityConfig);
      if (option) {
        updates.option = option;
      }
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  private extractOption(packet: number[], entityConfig: SelectEntity): string | null {
    const schema = entityConfig.state_select as any;
    if (!schema || !schema.map) return null;

    const offset = schema.offset || 0;
    const length = schema.length || 1;

    if (packet.length < offset + length) return null;

    let value = 0;
    if (length === 1) {
      value = packet[offset];
    } else {
      // Simple multi-byte support (big endian default)
      for (let i = 0; i < length; i++) {
        value = (value << 8) | packet[offset + i];
      }
    }

    // Check map
    if (schema.map[value]) {
      return schema.map[value];
    }

    return null;
  }

  public constructCommand(commandName: string, value?: any): number[] | null {
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
