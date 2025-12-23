import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';
import { TextEntity } from '../../domain/entities/text.entity.js';

export class TextDevice extends GenericDevice {
  constructor(config: TextEntity, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: number[]): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }

    const updates = super.parseData(packet) || {};
    const entityConfig = this.config as TextEntity;

    // Parse text value from state_text schema
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
    const cmd = super.constructCommand(commandName, value);
    if (cmd) return cmd;

    const entityConfig = this.config as TextEntity;

    // Handle text command with string value
    if (commandName === 'set' && entityConfig.command_text?.data && value !== undefined) {
      const command = [...entityConfig.command_text.data];

      // If there's a value offset, insert the text as ASCII bytes
      const valueOffset = (entityConfig.command_text as any).value_offset;
      if (valueOffset !== undefined) {
        const maxLength =
          (entityConfig.command_text as any).length || entityConfig.max_length || 16;
        const textStr = String(value);

        // Insert text bytes into command
        for (let i = 0; i < Math.min(textStr.length, maxLength); i++) {
          command[valueOffset + i] = textStr.charCodeAt(i);
        }

        // Pad with null bytes if needed
        for (let i = textStr.length; i < maxLength; i++) {
          command[valueOffset + i] = 0x00;
        }
      }

      return command;
    }

    return null;
  }
}
