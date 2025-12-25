import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';
import { ValveEntity } from '../../domain/entities/valve.entity.js';

export class ValveDevice extends GenericDevice {
  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: number[]): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as ValveEntity;

    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    // Handle basic open/closed states
    if (!updates.state) {
      if (entityConfig.state_open && this.matchState(payload, entityConfig.state_open)) {
        updates.state = 'OPEN';
      } else if (entityConfig.state_closed && this.matchState(payload, entityConfig.state_closed)) {
        updates.state = 'CLOSED';
      } else if (
        entityConfig.state_opening &&
        this.matchState(payload, entityConfig.state_opening)
      ) {
        updates.state = 'OPENING';
      } else if (
        entityConfig.state_closing &&
        this.matchState(payload, entityConfig.state_closing)
      ) {
        updates.state = 'CLOSING';
      }
    }

    // Handle position (0-100%)
    if (!updates.position && entityConfig.state_position) {
      const position = this.extractValue(payload, entityConfig.state_position);
      if (position !== null && typeof position === 'number') {
        updates.position = Math.min(100, Math.max(0, position));
      }
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  public constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | null {
    const entityConfig = this.config as ValveEntity;
    const commandConfig = (entityConfig as any)[`command_${commandName}`];

    // If CEL string, let GenericDevice handle it
    if (typeof commandConfig === 'string') {
      return super.constructCommand(commandName, value, states);
    }

    if (commandName === 'open' && entityConfig.command_open?.data) {
      return super.constructCommand(commandName, value, states);
    }
    if (commandName === 'close' && entityConfig.command_close?.data) {
      return super.constructCommand(commandName, value, states);
    }

    // Handle stop command
    if (commandName === 'stop' && entityConfig.command_stop?.data) {
      return super.constructCommand(commandName, value, states);
    }

    // Handle position command (0-100%)
    if (commandName === 'position' && entityConfig.command_position?.data && value !== undefined) {
      const command = [...entityConfig.command_position.data];
      const valueOffset = (entityConfig.command_position as any).value_offset;
      if (valueOffset !== undefined) {
        const position = Math.min(100, Math.max(0, Math.round(value)));
        command[valueOffset] = position;
      }
      return this.framePacket(command);
    }

    return null;
  }
}
