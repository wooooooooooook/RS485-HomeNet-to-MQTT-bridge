import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';
import { LockEntity } from '../../domain/entities/lock.entity.js';

export class LockDevice extends GenericDevice {
  constructor(config: LockEntity, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: number[]): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }

    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as LockEntity;

    // Determine lock state based on state schemas
    if (!updates.state) {
      if (this.matchesSchema(packet, entityConfig.state_locked)) {
        updates.state = 'LOCKED';
      } else if (this.matchesSchema(packet, entityConfig.state_unlocked)) {
        updates.state = 'UNLOCKED';
      } else if (this.matchesSchema(packet, entityConfig.state_locking)) {
        updates.state = 'LOCKING';
      } else if (this.matchesSchema(packet, entityConfig.state_unlocking)) {
        updates.state = 'UNLOCKING';
      } else if (this.matchesSchema(packet, entityConfig.state_jammed)) {
        updates.state = 'JAMMED';
      }
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  private matchesSchema(packet: number[], schema: any): boolean {
    if (!schema || !schema.data) return false;

    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const offset = (schema.offset || 0) + headerLength;
    if (packet.length < offset + schema.data.length) return false;

    for (let i = 0; i < schema.data.length; i++) {
      let mask = 0xff;
      if (schema.mask) {
        if (Array.isArray(schema.mask)) {
          mask = schema.mask[i];
        } else {
          mask = schema.mask;
        }
      }

      const expectedValue = schema.inverted ? ~schema.data[i] & 0xff : schema.data[i];
      if ((packet[offset + i] & mask) !== (expectedValue & mask)) {
        return false;
      }
    }
    return true;
  }

  public constructCommand(commandName: string, value?: any): number[] | { type: "script"; id: string } | null {
    const cmd = super.constructCommand(commandName, value);
    if (cmd) return cmd;

    const entityConfig = this.config as LockEntity;

    if (commandName === 'lock' && entityConfig.command_lock?.data) {
      return [...entityConfig.command_lock.data];
    }

    if (commandName === 'unlock' && entityConfig.command_unlock?.data) {
      return [...entityConfig.command_unlock.data];
    }

    return null;
  }
}
