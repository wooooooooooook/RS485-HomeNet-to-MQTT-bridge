import { GenericDevice } from './generic.device.js';
import { ProtocolConfig, CommandResult } from '../types.js';
import { NumberEntity } from '../../domain/entities/number.entity.js';
import { normalizeDeviceState } from './state-normalizer.js';

export class NumberDevice extends GenericDevice {
  constructor(config: NumberEntity, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: Buffer): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }

    const updates = super.parseData(packet) || {};
    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    const normalized = normalizeDeviceState({ ...this.config, type: 'number' } as NumberEntity, payload, updates, {
      headerLen: headerLength,
      state: this.getState(),
    });

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  public constructCommand(commandName: string, value?: any): number[] | CommandResult | null {
    const cmd = super.constructCommand(commandName, value);
    if (cmd) return cmd;

    const entityConfig = this.config as NumberEntity;

    // Handle number command with value (uses shared insertValueIntoCommand)
    if (commandName === 'set' && entityConfig.command_number?.data && value !== undefined) {
      return this.insertValueIntoCommand(entityConfig.command_number, value);
    }

    return null;
  }
}
