import { Device } from '../device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';
import { StateSchema, StateNumSchema } from '../types.js';
import { Buffer } from 'buffer';
import { CelExecutor } from '../cel-executor.js';
import { logger } from '../../utils/logger.js';
import { calculateChecksum, calculateChecksum2, ChecksumType, Checksum2Type } from '../utils/checksum.js';

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
    // This is where we would use the schema to extract data
    // For now, let's assume simple state extraction based on 'state' property in config if it exists
    // The actual config structure for entities is in EntityConfig, which extends DeviceConfig (sort of)

    // Example logic: check if packet matches 'state' pattern
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

    let commandPacket: number[] | null = null;

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
          // Result might be array of arrays (packet + ack + mask) or just packet
          // Uartex returns {{packet}, {ack}, {mask}}
          // We need to handle this. For now assuming it returns just the packet data or the first element if array of arrays.
          if (Array.isArray(result[0])) {
            commandPacket = result[0];
          } else {
            commandPacket = result;
          }
        }
      } else if (commandConfig.data) {
        commandPacket = [...commandConfig.data];
      }
    }

    const packetDefaults = this.protocolConfig.packet_defaults;

    if (commandPacket && packetDefaults?.tx_checksum && packetDefaults.tx_checksum !== 'none') {
      const txHeader = packetDefaults.tx_header || [];
      const headerPart = Buffer.from(txHeader);
      const dataPart = Buffer.from(commandPacket);
      const checksumType = packetDefaults.tx_checksum as ChecksumType;

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
          const checksum = calculateChecksum(headerPart, dataPart, checksumType);
          commandPacket.push(checksum);
        } else {
          // CEL Expression
          // Pass full packet (header + cmd) as 'data' for checksum calculation
          const fullData = [...txHeader, ...commandPacket];
          const result = this.celExecutor.execute(checksumType, {
            data: fullData,
            len: fullData.length,
          });
          if (typeof result === 'number') {
            commandPacket.push(result);
          } else if (Array.isArray(result)) {
            // If returns array (like 2-byte checksum)
            commandPacket.push(...result);
          }
        }
      }
    } else if (commandPacket && packetDefaults?.tx_checksum2) {
      const txHeader = packetDefaults.tx_header || [];
      const headerPart = Buffer.from(txHeader);
      const dataPart = Buffer.from(commandPacket);

      const checksum2Types = new Set(['xor_add']);

      if (typeof packetDefaults.tx_checksum2 === 'string') {
        const checksumOrScript = packetDefaults.tx_checksum2;

        if (checksum2Types.has(checksumOrScript)) {
          const checksum = calculateChecksum2(headerPart, dataPart, checksumOrScript as Checksum2Type);
          commandPacket.push(...checksum);
        } else {
          const fullData = [...txHeader, ...commandPacket];
          const result = this.celExecutor.execute(checksumOrScript, {
            data: fullData,
            len: fullData.length,
          });

          if (Array.isArray(result) && result.length === 2) {
            commandPacket.push(...result);
          } else {
            logger.error(
              `CEL tx_checksum2 returned invalid result. Expected array of 2 bytes, got: ${JSON.stringify(result)}`,
            );
          }
        }
      } else {
        logger.warn('Unknown tx_checksum2 type');
      }
    }

    return commandPacket;
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
