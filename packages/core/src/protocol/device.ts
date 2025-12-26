import { matchesPacket } from '../utils/packet-matching.js';
import { DeviceConfig, StateSchema, StateNumSchema, ProtocolConfig } from './types.js';

export abstract class Device {
  protected config: DeviceConfig;
  protected protocolConfig: ProtocolConfig;
  protected state: Record<string, any> = {};

  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    this.config = config;
    this.protocolConfig = protocolConfig;
  }

  public abstract parseData(packet: number[]): Record<string, any> | null;

  public abstract constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | null;

  public getOptimisticState(commandName: string, value?: any): Record<string, any> | null {
    return null;
  }

  public getId(): string {
    return this.config.id;
  }

  public getName(): string {
    return this.config.name;
  }

  public getState(): Record<string, any> {
    return this.state;
  }

  protected updateState(newState: Record<string, any>) {
    this.state = { ...this.state, ...newState };
  }

  // Helper to extract data based on schema
  protected extractFromSchema(packet: number[], schema: StateSchema | StateNumSchema): any {
    const { offset = 0, data, mask, inverted = false } = schema;

    // Determine length
    let length = 1;
    if ('length' in schema && typeof (schema as any).length === 'number') {
      length = (schema as any).length;
    } else if (data) {
      length = data.length;
    }

    // Safety check
    if (offset + length > packet.length) {
      return null;
    }

    // 1. Check Data Match (if data is provided)
    if (data) {
      for (let i = 0; i < data.length; i++) {
        const pByte = packet[offset + i];
        const dByte = data[i];
        let mByte = 0xff;

        if (mask) {
          if (Array.isArray(mask)) {
            mByte = mask[i] ?? 0xff;
          } else {
            mByte = mask;
          }
        }

        if ((pByte & mByte) !== (dByte & mByte)) {
          return null; // Mismatch
        }
      }
    }

    // 2. Extract Value
    const extractedBytes: number[] = [];
    for (let i = 0; i < length; i++) {
      let val = packet[offset + i];
      let mByte = 0xff;
      if (mask) {
        if (Array.isArray(mask)) {
          mByte = mask[i] ?? 0xff;
        } else {
          mByte = mask;
        }
      }

      // Apply Inverted (bitwise NOT before mask)
      if (inverted) {
        val = ~val;
      }

      val = val & mByte;
      extractedBytes.push(val);
    }

    // 3. Process as Number (if StateNumSchema)
    const numSchema = schema as StateNumSchema;
    const endian = numSchema.endian || 'big';
    const decode = numSchema.decode || 'none';
    const signed = numSchema.signed || false;
    const precision = numSchema.precision || 0;

    // Handle byte order
    if (endian === 'little') {
      extractedBytes.reverse();
    }

    let value: number | string = 0;

    // Decoding Logic
    if (decode === 'ascii') {
      value = String.fromCharCode(...extractedBytes);
      return value;
    } else if (decode === 'bcd') {
      let bcdVal = 0;
      for (const b of extractedBytes) {
        bcdVal = bcdVal * 100 + (b >> 4) * 10 + (b & 0x0f);
      }
      value = bcdVal;
    } else if (decode === 'signed_byte_half_degree') {
      const b = extractedBytes[0];
      // Note: This logic assumes 'b' is the processed byte (masked/inverted).
      // Standard usage implies raw byte, but here we applied mask/invert.
      // Assuming consistent schema configuration.
      let val = b & 0x7f;
      if ((b & 0x80) !== 0) {
        val += 0.5;
      }
      if (signed && (b & 0x40) !== 0) {
        val = -val;
      }
      value = val;
    } else {
      // 'none' or default integer combination
      // Use * 256 to avoid 32-bit signed overflow during shift
      let intVal = 0;
      for (const b of extractedBytes) {
        intVal = intVal * 256 + b;
      }
      value = intVal;
    }

    // Signed integer handling (Two's complement)
    if (typeof value === 'number' && signed && decode === 'none') {
      const bitLen = length * 8;
      // Calculate max unsigned value for this bit length
      const maxUnsigned = Math.pow(2, bitLen);
      // If sign bit is set (value >= maxUnsigned / 2)
      if (value >= maxUnsigned / 2) {
        value = value - maxUnsigned;
      }
    }

    // Precision
    if (typeof value === 'number' && precision > 0) {
      value = parseFloat((value / Math.pow(10, precision)).toFixed(precision));
    }

    // Mapping
    if (typeof value === 'number' && numSchema.mapping) {
      if (value in numSchema.mapping) {
        return numSchema.mapping[value];
      }
    }

    return value;
  }

  public matchesPacket(packet: number[]): boolean {
    const stateConfig = this.config.state;
    if (!stateConfig || !stateConfig.data) {
      // If no state config, we can't match based on state pattern.
      // However, some devices might be command-only or use other matching.
      // But for the purpose of "state update", we usually need a match.
      // Let's return false to be safe, preventing random updates.
      return false;
    }

    // Adjust offset by header length if present
    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;

    return matchesPacket(stateConfig, packet, {
      baseOffset: headerLength,
      context: { state: this.getState() },
    });
  }
}
