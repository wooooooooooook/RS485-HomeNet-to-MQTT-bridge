import { Device } from '../device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';
import { StateSchema, StateNumSchema } from '../types.js';
import { CelExecutor } from '../cel-executor.js';
import {
  calculateChecksum,
  calculateChecksum2,
  ChecksumType,
  Checksum2Type,
} from '../utils/checksum.js';
import { logger } from '../../utils/logger.js';
import { Buffer } from 'buffer';

export class GenericDevice extends Device {
  private celExecutor: CelExecutor;

  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
    this.celExecutor = new CelExecutor();
  }

  public parseData(
    packet: number[],
    states?: Map<string, Record<string, any>>,
  ): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    const entityConfig = this.config as any;
    const updates: Record<string, any> = {};
    let hasUpdates = false;

    // Key mapping for lambda results to match HA discovery expectations
    const keyMapping: Record<string, string> = {
      temperature_target: 'target_temperature',
      temperature_current: 'current_temperature',
      humidity_target: 'target_humidity',
      humidity_current: 'current_humidity',
    };

    // Check for state expressions (formerly lambdas)
    for (const key in entityConfig) {
      if (key.startsWith('state_') && typeof entityConfig[key] === 'string') {
        const script = entityConfig[key] as string;
        const result = this.celExecutor.execute(script, {
          data: packet,
          x: null, // No previous value for state extraction usually
          states: states ? Object.fromEntries(states) : {}, // Pass global states if available
        });

        if (result !== undefined && result !== null && result !== '') {
          // Remove 'state_' prefix and apply key mapping if needed
          let stateKey = key.replace('state_', '');
          if (keyMapping[stateKey]) {
            stateKey = keyMapping[stateKey];
          }
          updates[stateKey] = result;
          hasUpdates = true;
        }
      }
    }

    // Fallback to schema-based extraction if no lambda matched or as addition
    if (entityConfig.state && entityConfig.state.data) {
      // Check if packet contains the data pattern
      // This is a simplification. Uartex has complex matching logic.
      // For this refactor, we might need to implement a robust matcher.
    }

    return hasUpdates ? updates : null;
  }

  public constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | null {
    const entityConfig = this.config as any;
    const commandKey = `command_${commandName}`;
    const commandConfig = entityConfig[commandKey];

    let commandData: number[] | null = null;

    if (commandConfig) {
      if (typeof commandConfig === 'string') {
        const script = commandConfig as string;
        const result = this.celExecutor.execute(script, {
          x: value,
          data: [], // No packet data for command construction
          state: this.getState() || {},
          states: states ? Object.fromEntries(states) : {}, // Pass global states
        });

        if (Array.isArray(result)) {
          if (Array.isArray(result[0])) {
            commandData = result[0];
          } else {
            commandData = result;
          }
        }
      } else if (commandConfig.data) {
        commandData = [...commandConfig.data];
      }
    }

    if (commandData) {
      const packetDefaults = this.protocolConfig.packet_defaults || {};
      const txHeader = packetDefaults.tx_header || [];
      const txFooter = packetDefaults.tx_footer || [];

      const headerPart = Buffer.from(txHeader);
      const dataPart = Buffer.from(commandData);

      let checksumPart: number[] = [];

      // Check for 1-byte checksum first
      if (packetDefaults.tx_checksum && packetDefaults.tx_checksum !== 'none') {
        const checksumType = packetDefaults.tx_checksum as ChecksumType | string;

        const standardChecksums = new Set([
          'add',
          'xor',
          'add_no_header',
          'xor_no_header',
          'samsung_rx',
          'samsung_tx',
          'none',
        ]);

        if (typeof checksumType === 'string') {
          if (standardChecksums.has(checksumType)) {
            const checksum = calculateChecksum(headerPart, dataPart, checksumType as ChecksumType);
            checksumPart.push(checksum);
          } else {
            // CEL Expression
            const fullData = [...txHeader, ...commandData];
            const result = this.celExecutor.execute(checksumType, {
              data: fullData,
              len: fullData.length,
            });
            if (typeof result === 'number') {
              checksumPart.push(result);
            } else if (Array.isArray(result)) {
              checksumPart.push(...result);
            }
          }
        }
      }
      // Check for 2-byte checksum if 1-byte checksum is not used
      else if (packetDefaults.tx_checksum2) {
         const checksumType = packetDefaults.tx_checksum2 as Checksum2Type | string;
         const standardChecksums2 = new Set(['xor_add']);

         if (typeof checksumType === 'string') {
           if (standardChecksums2.has(checksumType)) {
             const checksum = calculateChecksum2(headerPart, dataPart, checksumType as Checksum2Type);
             checksumPart.push(...checksum);
           } else {
              // CEL Expression for 2-byte checksum
              const fullData = [...txHeader, ...commandData];
              const result = this.celExecutor.execute(checksumType, {
                data: fullData,
                len: fullData.length,
              });
              if (Array.isArray(result)) {
                 checksumPart.push(...result);
              } else {
                 logger.warn(`CEL tx_checksum2 returned invalid result: ${result}`);
              }
           }
         }
      }

      // Construct full packet: Header + Data + Checksum + Footer
      return [...txHeader, ...commandData, ...checksumPart, ...txFooter];
    }

    return null;
  }

  // --- Helper methods for parsing (moved from PacketParser) ---

  /**
   * Check if packet data matches a state schema pattern
   */
  protected matchState(packetData: number[], stateSchema: StateSchema | undefined): boolean {
    if (!stateSchema) return false;

    const { data, mask, offset = 0, inverted = false } = stateSchema;

    if (!data || data.length === 0) {
      return true;
    }

    if (offset + data.length > packetData.length) {
      return false;
    }

    let isMatch = true;
    for (let i = 0; i < data.length; i++) {
      const packetByte = packetData[offset + i];
      const patternByte = data[i];
      let effectivePacketByte = packetByte;
      let effectivePatternByte = patternByte;

      if (mask) {
        const currentMask = Array.isArray(mask) ? mask[i] : mask;
        if (currentMask !== undefined) {
          effectivePacketByte = packetByte & currentMask;
          effectivePatternByte = patternByte & currentMask;
        }
      }

      if (effectivePacketByte !== effectivePatternByte) {
        isMatch = false;
        break;
      }
    }

    return inverted ? !isMatch : isMatch;
  }

  /**
   * Extract a numeric or string value from packet bytes using a schema
   */
  protected extractValue(bytes: number[], schema: StateNumSchema): number | string | null {
    const {
      offset,
      length = 1,
      precision = 0,
      signed = false,
      endian = 'big',
      decode = 'none',
    } = schema;

    if (offset === undefined || offset + length > bytes.length) {
      return null;
    }

    const valueBytes = bytes.slice(offset, offset + length);
    if (endian === 'little') {
      valueBytes.reverse();
    }

    let value: number;
    switch (decode) {
      case 'bcd':
        value = 0;
        for (let i = 0; i < valueBytes.length; i++) {
          value = value * 100 + (valueBytes[i] >> 4) * 10 + (valueBytes[i] & 0x0f);
        }
        break;
      case 'ascii':
        return String.fromCharCode(...valueBytes);
      case 'signed_byte_half_degree':
        value = valueBytes[0] & 0x7f;
        if ((valueBytes[0] & 0x80) !== 0) {
          value += 0.5;
        }
        if (signed && (valueBytes[0] & 0x40) !== 0) {
          value = -value;
        }
        break;
      case 'none':
      default:
        value = 0;
        for (let i = 0; i < valueBytes.length; i++) {
          value = (value << 8) | valueBytes[i];
        }
        break;
    }

    if (signed && (valueBytes[0] & 0x80) !== 0 && decode === 'none') {
      const signBit = 1 << (length * 8 - 1);
      if ((value & signBit) !== 0) {
        value = value - 2 * signBit;
      }
    }

    // Apply precision (division)
    if (precision > 0) {
      return parseFloat((value / Math.pow(10, precision)).toFixed(precision));
    }

    return value;
  }
}
