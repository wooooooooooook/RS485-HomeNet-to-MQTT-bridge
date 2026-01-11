import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig, CommandResult } from '../types.js';
import { normalizeDeviceState } from './state-normalizer.js';

export class SwitchDevice extends GenericDevice {
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
    const normalized = normalizeDeviceState({ ...this.config, type: 'switch' }, payload, updates, {
      headerLen: headerLength,
      state: this.getState(),
    });

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  public constructCommand(commandName: string, value?: any): number[] | CommandResult | null {
    const cmd = super.constructCommand(commandName, value);
    if (cmd) return cmd;

    const entityConfig = this.config as any;
    if (commandName === 'on' && entityConfig.command_on?.data) {
      return [...entityConfig.command_on.data];
    }
    if (commandName === 'off' && entityConfig.command_off?.data) {
      return [...entityConfig.command_off.data];
    }

    return null;
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
