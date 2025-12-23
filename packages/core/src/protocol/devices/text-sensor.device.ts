import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';
import { TextSensorEntity } from '../../domain/entities/text-sensor.entity.js';

export class TextSensorDevice extends GenericDevice {
  constructor(config: TextSensorEntity, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: number[]): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }

    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as TextSensorEntity;

    // Parse text value from state_text schema
    // This would ideally execute a lambda to extract text
    // For now, we'll try to extract ASCII text from the packet
    if (!updates.text && entityConfig.state_text) {
      const text = this.extractText(packet, entityConfig.state_text);
      if (text !== null) {
        updates.text = text;
      }
    }

    return Object.keys(updates).length > 0 ? updates : null;
  }

  private extractText(packet: number[], schema: any): string | null {
    if (!schema) return null;

    const offset = schema.offset || 0;
    const length = schema.length || 1;

    if (packet.length < offset + length) return null;

    // Extract ASCII text from packet
    let text = '';
    for (let i = 0; i < length; i++) {
      const byte = packet[offset + i];
      // Only include printable ASCII characters
      if (byte >= 0x20 && byte <= 0x7e) {
        text += String.fromCharCode(byte);
      } else if (byte === 0x00) {
        // Null terminator
        break;
      }
    }

    return text.length > 0 ? text : null;
  }

  public constructCommand(commandName: string, value?: any): number[] | { type: "script"; id: string } | null {
    // Text sensor is read-only, no commands
    return super.constructCommand(commandName, value);
  }
}
