import { GenericDevice } from './generic.device.js';
import { ProtocolConfig, CommandResult } from '../types.js';
import { LockEntity } from '../../domain/entities/lock.entity.js';
import { normalizeDeviceState } from './state-normalizer.js';

export class LockDevice extends GenericDevice {
  constructor(config: LockEntity, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: Buffer): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }

    const updates = super.parseData(packet) || {};
    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    const normalized = normalizeDeviceState({ ...this.config, type: 'lock' } as LockEntity, payload, updates, {
      headerLen: headerLength,
      state: this.getState(),
    });

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  public constructCommand(commandName: string, value?: any): number[] | CommandResult | null {
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
