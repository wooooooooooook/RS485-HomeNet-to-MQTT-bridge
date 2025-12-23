import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class SwitchDevice extends GenericDevice {
  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: number[]): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as any;

    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    if (!updates.state) {
      if (entityConfig.state_on && this.matchState(payload, entityConfig.state_on)) {
        updates.state = 'ON';
      } else if (entityConfig.state_off && this.matchState(payload, entityConfig.state_off)) {
        updates.state = 'OFF';
      }
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  public constructCommand(commandName: string, value?: any): number[] | { type: "script"; id: string } | null {
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

  public getOptimisticState(commandName: string, value?: any): Record<string, any> | null {
    if (commandName === 'on') {
      return { state: 'ON' };
    }
    if (commandName === 'off') {
      return { state: 'OFF' };
    }
    return null;
  }
}
