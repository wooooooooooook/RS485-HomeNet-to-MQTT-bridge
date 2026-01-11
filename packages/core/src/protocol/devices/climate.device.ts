import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig, CommandResult } from '../types.js';
import { normalizeDeviceState } from './state-normalizer.js';

export class ClimateDevice extends GenericDevice {
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
    const normalized = normalizeDeviceState({ ...this.config, type: 'climate' }, payload, updates, {
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
    const entityConfig = this.config as any;
    const normalizedCommandName = commandName.startsWith('command_')
      ? commandName
      : `command_${commandName}`;
    const commandConfig = entityConfig[normalizedCommandName];

    // 1. If it's a script (string), let GenericDevice (super) handle it.
    if (typeof commandConfig === 'string') {
      return super.constructCommand(commandName, value, states);
    }

    // 2. Handle specific value injection for temperature/humidity (overrides static data)
    if (value !== undefined) {
      if (
        commandName === 'temperature' &&
        commandConfig?.value_offset !== undefined &&
        commandConfig?.data
      ) {
        const data = this.insertValueIntoCommand(commandConfig, value);
        return data ? this.framePacket(data) : null;
      }
      if (
        commandName === 'humidity' &&
        commandConfig?.value_offset !== undefined &&
        commandConfig?.data
      ) {
        const data = this.insertValueIntoCommand(commandConfig, value);
        return data ? this.framePacket(data) : null;
      }
    }

    // 3. Fallback to GenericDevice for everything else (static data, simple scripts if any)
    return super.constructCommand(commandName, value, states);
  }
}
