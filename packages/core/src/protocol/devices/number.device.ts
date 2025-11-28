import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';
import { NumberEntity } from '../../domain/entities/number.entity.js';

export class NumberDevice extends GenericDevice {
  constructor(config: NumberEntity, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: number[]): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }

    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as NumberEntity;

    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    // Parse number value from state_number schema
    if (!updates.value && entityConfig.state_number) {
      const val = this.extractValue(payload, entityConfig.state_number);
      if (val !== null) {
        updates.value = val;
      }
    }

    // Check for increment/decrement/min/max state changes
    if (entityConfig.state_increment && this.matchState(payload, entityConfig.state_increment)) {
      updates.action = 'increment';
    } else if (
      entityConfig.state_decrement &&
      this.matchState(payload, entityConfig.state_decrement)
    ) {
      updates.action = 'decrement';
    } else if (entityConfig.state_to_min && this.matchState(payload, entityConfig.state_to_min)) {
      updates.value = entityConfig.min_value;
    } else if (entityConfig.state_to_max && this.matchState(payload, entityConfig.state_to_max)) {
      updates.value = entityConfig.max_value;
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  public constructCommand(commandName: string, value?: any): number[] | null {
    const cmd = super.constructCommand(commandName, value);
    if (cmd) return cmd;

    const entityConfig = this.config as NumberEntity;

    // Handle number command with value
    if (commandName === 'set' && entityConfig.command_number?.data && value !== undefined) {
      const command = [...entityConfig.command_number.data];

      // If there's a value offset, insert the value
      const valueOffset = (entityConfig.command_number as any).value_offset;
      if (valueOffset !== undefined) {
        const length = (entityConfig.command_number as any).length || 1;
        const precision = (entityConfig.command_number as any).precision || 0;

        // Apply precision
        let intValue = Math.round(value * Math.pow(10, precision));

        // Insert value into command
        if (length === 1) {
          command[valueOffset] = intValue & 0xff;
        } else {
          // TODO: Handle multi-byte and endianness
          for (let i = 0; i < length; i++) {
            command[valueOffset + i] = (intValue >> (8 * (length - 1 - i))) & 0xff;
          }
        }
      }

      return command;
    }

    return null;
  }
}
