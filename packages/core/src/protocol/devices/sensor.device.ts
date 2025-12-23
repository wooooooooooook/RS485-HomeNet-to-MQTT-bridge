import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class SensorDevice extends GenericDevice {
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
    // Handle generic state extraction if defined
    // e.g., state_number
    if (!updates.value && entityConfig.state_number) {
      const val = this.extractValue(payload, entityConfig.state_number);
      if (val !== null) updates.value = val;
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  public constructCommand(commandName: string, value?: any): number[] | { type: "script"; id: string } | null {
    return super.constructCommand(commandName, value);
  }
}
