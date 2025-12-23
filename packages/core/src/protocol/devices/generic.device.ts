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

/**
 * A versatile device implementation that supports dynamic parsing and command generation
 * using schema-based configurations and CEL (Common Expression Language) expressions.
 *
 * This class is the backbone of the "Generic" device type, allowing users to define
 * custom protocols purely through YAML configuration without writing TypeScript code.
 *
 * Key features:
 * - **Packet Parsing**: Extracts state values using binary schemas (mask, offset) or CEL expressions.
 * - **Command Construction**: Generates command packets using static data or CEL scripts.
 * - **Checksums**: Supports standard algorithms (XOR, ADD, CRC) and custom CEL-based checksums.
 * - **State Management**: Integrates with the global state store for cross-entity logic.
 *
 * @see {@link ../../../docs/CEL_GUIDE.md} for details on writing CEL expressions.
 */
export class GenericDevice extends Device {
  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  private getExecutor(): CelExecutor {
    return CelExecutor.shared();
  }

  /**
   * Parses an incoming packet to extract entity state updates.
   *
   * The parsing logic prioritizes methods in the following order:
   * 1. **CEL Expressions (`state_*`)**: Explicit CEL scripts defined in the config (e.g., `state_power: "data[3] == 0x01"`).
   *    - Context: `data` (packet bytes), `states` (global state map).
   * 2. **Schema Extraction**: (Currently limited implementation in this base class) Fallback to `state` schema.
   *
   * @param packet - The received packet as an array of bytes.
   * @param states - Optional map of all global entity states, injected into the CEL context.
   * @returns A dictionary of state updates (e.g., `{ power: 'on', temperature: 24 }`) or `null` if no match/updates.
   */
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
        const result = this.getExecutor().execute(script, {
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

  /**
   * Constructs a raw command packet for a specific action.
   *
   * Uses the `command_<name>` configuration which can be:
   * - A **CEL String**: Evaluated to produce a byte array or single number.
   *   - Context: `x` (command value), `state` (current device state), `states` (global state map).
   * - A **Static Object**: `{ data: [...] }` containing fixed bytes.
   *
   * @param commandName - The name of the command to execute (e.g., 'power', 'temp').
   * @param value - The value associated with the command (e.g., 'on', 24).
   * @param states - Optional map of all global entity states.
   * @returns The raw packet bytes (including header/footer/checksum) or `null` if construction failed.
   */
  public constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | { type: 'script'; id: string } | null {
    const entityConfig = this.config as any;
    const commandKey = `command_${commandName}`;
    const commandConfig = entityConfig[commandKey];

    let commandData: number[] | { type: "script"; id: string } | null = null;

    if (commandConfig) {
      if (typeof commandConfig === 'string') {
        const script = commandConfig as string;
        const result = this.getExecutor().execute(script, {
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
      } else if (typeof commandConfig === 'object') {
        if (commandConfig.script) {
          return { type: 'script', id: commandConfig.script };
        }
        if (commandConfig.data) {
          commandData = [...commandConfig.data];
        }
      }
    }

    if (commandData) {
      return this.framePacket(commandData);
    }

    return null;
  }

  /**
   * Frames the command data with the configured header, footer, and checksums.
   *
   * Steps:
   * 1. Prepends `tx_header`.
   * 2. Appends `commandData`.
   * 3. Calculates and appends `tx_checksum` (1-byte) OR `tx_checksum2` (2-byte) if configured.
   *    - Supports standard algorithms (e.g., 'xor', 'add', 'crc') and CEL expressions.
   * 4. Appends `tx_footer`.
   *
   * @param commandData - The payload bytes of the command.
   * @returns The fully framed packet ready for transmission.
   */
  protected framePacket(commandData: number[]): number[] {
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
          const result = this.getExecutor().execute(checksumType, {
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
          const result = this.getExecutor().execute(checksumType, {
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

  // --- Helper methods for parsing (moved from PacketParser) ---

  /**
   * Checks if a packet segment matches a defined binary pattern.
   *
   * @param packetData - The full packet buffer.
   * @param stateSchema - The schema defining the expected data, mask, and offset.
   * @returns `true` if the packet matches the schema's pattern.
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
   * Extracts and decodes a value from the packet based on a numeric schema.
   *
   * Supports various decoding strategies:
   * - **BCD**: Binary Coded Decimal.
   * - **ASCII**: Text strings.
   * - **Signed/Unsigned**: Integers with endianness control.
   * - **Precision**: Floating point scaling.
   *
   * @param bytes - The packet buffer.
   * @param schema - The schema defining offset, length, type, and decoding rules.
   * @returns The extracted number or string, or `null` if extraction fails (e.g. out of bounds).
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
