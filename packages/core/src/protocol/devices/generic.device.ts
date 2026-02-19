import { Device } from '../device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';
import { StateSchema, StateNumSchema } from '../types.js';
import { matchesPacket } from '../../utils/packet-matching.js';
import { CelExecutor, CompiledScript } from '../cel-executor.js';
import {
  calculateChecksum,
  calculateChecksum2,
  ChecksumType,
  Checksum2Type,
} from '../utils/checksum.js';
import { logger } from '../../utils/logger.js';
import { Buffer } from 'buffer';

interface StateScript {
  key: string;
  script: CompiledScript;
}

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
  // Optimization: Cache prepared scripts to avoid parsing/lookups on every packet
  private stateScripts: StateScript[] = [];
  private commandScripts: Map<string, CompiledScript> = new Map();
  private static readonly EMPTY_STATES = {};
  // private reusableBufferView & reusableContext are inherited from Device

  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
    this.prepareScripts();
  }

  /**
   * Pre-compiles all CEL scripts defined in the configuration.
   * This runs once during device initialization.
   */
  private prepareScripts() {
    const entityConfig = this.config as any;
    const executor = CelExecutor.shared();

    // Key mapping for CEL results to match HA discovery expectations
    const keyMapping: Record<string, string> = {
      temperature_target: 'target_temperature',
      temperature_current: 'current_temperature',
      humidity_target: 'target_humidity',
      humidity_current: 'current_humidity',
    };

    for (const key in entityConfig) {
      const value = entityConfig[key];
      if (typeof value !== 'string') continue;

      if (key.startsWith('state_')) {
        // Prepare State Parsing Scripts
        const rawKey = key.replace('state_', '');
        const mappedKey = keyMapping[rawKey] || rawKey;
        try {
          this.stateScripts.push({
            key: mappedKey,
            script: executor.prepare(value),
          });
        } catch (err) {
          logger.warn({ err, key, value }, '[GenericDevice] Failed to compile state script');
        }
      } else if (key.startsWith('command_')) {
        // Prepare Command Generation Scripts
        try {
          this.commandScripts.set(key, executor.prepare(value));
        } catch (err) {
          logger.warn({ err, key, value }, '[GenericDevice] Failed to compile command script');
        }
      }
    }
  }

  /**
   * Parses an incoming packet to extract entity state updates.
   *
   * The parsing logic prioritizes methods in the following order:
   * 1. **CEL Expressions (`state_*`)**: Explicit CEL scripts defined in the config (e.g., `state_power: "data[3] == 0x01"`).
   *    - Context: `data` (packet bytes), `states` (global state map).
   * 2. **Schema Extraction**: (Currently limited implementation in this base class) Fallback to `state` schema.
   *
   * @param packet - The received packet as a Buffer of bytes.
   * @param states - Optional map of all global entity states, injected into the CEL context.
   * @returns A dictionary of state updates (e.g., `{ power: 'on', temperature: 24 }`) or `null` if no match/updates.
   */
  public parseData(
    packet: Buffer,
    states?: Map<string, Record<string, any>>,
  ): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }
    const updates: Record<string, any> = {};
    let hasUpdates = false;

    // Execute pre-compiled state scripts
    // Optimization: Iterating pre-filtered array avoids checking all config keys
    // and using prepared scripts avoids Map lookups and parsing overhead.
    const entityState = this.getState() || {};
    const statesObj = states ? Object.fromEntries(states) : GenericDevice.EMPTY_STATES;

    // Optimization: Reuse context object and avoid repeated allocations
    let useOptimization = false;
    if (this.reusableBufferView) {
      this.reusableBufferView.update(packet, 0, packet.length);
      this.reusableContext.len = BigInt(packet.length);
      this.reusableContext.state = entityState;
      this.reusableContext.states = statesObj;
      useOptimization = true;
    }

    for (const { key, script } of this.stateScripts) {
      let result: any;
      let error: string | undefined;

      if (useOptimization) {
        // Use executeRawWithDiagnostics to bypass safe context creation (since we manage it manually)
        // This saves significant object allocation overhead in hot loops.
        const res = script.executeRawWithDiagnostics(this.reusableContext);
        result = res.result;
        error = res.error;
      } else {
        // Fallback to slower safe path if optimization is unavailable
        const res = script.executeWithDiagnostics({
          data: packet,
          x: null,
          state: entityState,
          states: statesObj,
        });
        result = res.result;
        error = res.error;
      }

      if (error) {
        this.reportError({
          type: 'cel',
          message: error,
          context: { phase: 'state', key },
        });
        continue;
      }

      if (result !== undefined && result !== null && result !== '') {
        updates[key] = result;
        hasUpdates = true;
      }
    }

    return hasUpdates ? updates : null;
  }

  /**
   * Constructs a raw command packet for a specific action.
   *
   * Uses the `command_<name>` configuration which can be:
   * - A **CEL String**: Evaluated to produce a byte array or nested arrays.
   *   - Single array: `[0x01, 0x02]` → command data
   *   - 2 arrays: `[[0x01, 0x02], [0x03, 0x04]]` → [data, ack:data]
   *   - 3 arrays: `[[0x01, 0x02], [0x03, 0x04], [0xFF]]` → [data, ack:data, ack:mask]
   *   - Context: `x` (command value), `state` (current device state), `states` (global state map).
   * - A **Static Object**: `{ data: [...] }` containing fixed bytes.
   *
   * @param commandName - The name of the command to execute (e.g., 'power', 'temp').
   * @param value - The value associated with the command (e.g., 'on', 24).
   * @param states - Optional map of all global entity states.
   * @returns The raw packet bytes, CommandResult with ack info, or `null` if construction failed.
   */
  public constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | { packet: number[]; ack?: StateSchema } | null {
    const entityConfig = this.config as any;
    const normalizedCommandName = commandName.startsWith('command_')
      ? commandName
      : `command_${commandName}`;

    let commandData: number[] | null = null;
    let ackSchema: StateSchema | undefined;

    // Check if we have a pre-compiled CEL script for this command
    const preparedScript = this.commandScripts.get(normalizedCommandName);

    if (preparedScript) {
      // Execute CEL Script
      const entityState = {
        value: null,
        ...(states?.get(this.config.id) || this.getState() || {}),
      };
      const { result, error } = preparedScript.executeWithDiagnostics({
        x: value,
        data: [], // No packet data for command construction
        state: entityState,
        states: states ? Object.fromEntries(states) : {}, // Pass global states
      });

      if (error) {
        this.reportError({
          type: 'cel',
          message: error,
          context: { phase: 'command', command: normalizedCommandName },
        });
        return null;
      }

      if (Array.isArray(result)) {
        // Check if result is nested arrays (CEL returning multiple arrays)
        if (Array.isArray(result[0])) {
          // First array is command data
          commandData = result[0];

          // Second array is ack:data (if exists)
          if (result.length >= 2 && Array.isArray(result[1])) {
            ackSchema = { data: result[1] };

            // Third array is ack:mask (if exists)
            if (result.length >= 3 && Array.isArray(result[2])) {
              ackSchema.mask = result[2];
            }
          }
        } else {
          // Single flat array - just command data
          commandData = result;
        }
      }
    } else {
      // Fallback: Check for static configuration (e.g. { data: [...] })
      const commandConfig = entityConfig[normalizedCommandName];
      if (commandConfig && typeof commandConfig === 'object' && commandConfig.data) {
        commandData = [...commandConfig.data];
      }
    }

    if (commandData) {
      const packet = this.framePacket(commandData);
      // Return CommandResult if ack is defined, otherwise just the packet array
      if (ackSchema) {
        return { packet, ack: ackSchema };
      }
      return packet;
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
    const entityPacketParams = (this.config as any).packet_parameters || {};
    const packetDefaults = { ...(this.protocolConfig.packet_defaults || {}), ...entityPacketParams };
    // DEBUG: Log packetDefaults to verify tx_checksum presence
    if (logger.isLevelEnabled('debug')) {
      logger.debug({ packetDefaults }, '[GenericDevice] framePacket defaults');
    }
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
        'samsung_xor',
        'bestin_sum',
        'none',
      ]);

      if (typeof checksumType === 'string') {
        if (standardChecksums.has(checksumType)) {
          const checksum = calculateChecksum(headerPart, dataPart, checksumType as ChecksumType);
          checksumPart.push(checksum);
        } else {
          // CEL Expression
          // Note: tx_checksum is usually global, so we use shared execute (cached)
          // For further optimization, ProtocolManager could prepare these too.
          const fullData = [...txHeader, ...commandData];
          const { result, error } = CelExecutor.shared().executeWithDiagnostics(checksumType, {
            data: fullData,
            len: fullData.length,
          });
          if (error) {
            this.reportError({
              type: 'cel',
              message: error,
              context: { phase: 'checksum', checksumType },
            });
          }
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
          const { result, error } = CelExecutor.shared().executeWithDiagnostics(checksumType, {
            data: fullData,
            len: fullData.length,
          });
          if (error) {
            this.reportError({
              type: 'cel',
              message: error,
              context: { phase: 'checksum2', checksumType },
            });
          }
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
  protected matchState(packetData: Uint8Array, stateSchema: StateSchema | undefined): boolean {
    if (!stateSchema) return false;
    // offset이 명시되지 않은 경우에만 headerLen을 baseOffset으로 사용
    const headerLen = this.protocolConfig.packet_defaults?.rx_header?.length ?? 0;
    const baseOffset = stateSchema.offset === undefined ? headerLen : 0;
    return matchesPacket(stateSchema, packetData, {
      baseOffset,
      allowEmptyData: true,
      context: { state: this.getState() },
    });
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
  protected extractValue(bytes: Uint8Array, schema: StateNumSchema): number | string | null {
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

    const valueBytes: number[] = [];
    if (endian === 'little') {
      for (let i = offset + length - 1; i >= offset; i -= 1) {
        valueBytes.push(bytes[i]);
      }
    } else {
      for (let i = offset; i < offset + length; i += 1) {
        valueBytes.push(bytes[i]);
      }
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

  /**
   * Constructs a command packet by inserting a numeric value at the specified offset.
   *
   * This is a shared helper for entities that use CommandSchema with value_offset,
   * such as `number.command_number`, `climate.command_temperature`, etc.
   *
   * Supported options in commandSchema:
   * - `data`: Base command packet byte array
   * - `value_offset`: Byte position to insert the value (0-indexed)
   * - `length`: Number of bytes for the value (default: 1)
   * - `precision`: Decimal places to scale (e.g., 1 means multiply by 10, default: 0)
   * - `endian`: Byte order ('big' or 'little', default: 'big')
   * - `multiply_factor`: Multiplier for the value (default: 1)
   * - `value_encode`: Encoding type ('none', 'bcd', 'ascii', 'signed_byte_half_degree', default: 'none')
   *
   * @param commandSchema - The command configuration object containing data and value options.
   * @param value - The numeric value to insert into the command.
   * @returns The fully framed command packet, or null if data is missing.
   */
  protected insertValueIntoCommand(commandSchema: any, value: number): number[] | null {
    if (!commandSchema?.data) {
      return null;
    }

    const command = [...commandSchema.data];
    const valueOffset = commandSchema.value_offset;

    if (valueOffset !== undefined) {
      const length = commandSchema.length || 1;
      const precision = commandSchema.precision || 0;
      const endian = commandSchema.endian || 'big';
      const multiplyFactor = commandSchema.multiply_factor || 1;
      const valueEncode = commandSchema.value_encode || 'none';

      // Apply multiply_factor and precision
      let scaledValue = value * multiplyFactor * Math.pow(10, precision);

      // Encode the value based on value_encode type
      let encodedBytes: number[];
      switch (valueEncode) {
        case 'bcd':
          // BCD encoding: each byte stores two decimal digits
          encodedBytes = this.encodeBcd(Math.round(scaledValue), length);
          break;

        case 'ascii':
          // ASCII encoding: convert number to string, then to ASCII bytes
          encodedBytes = this.encodeAscii(scaledValue, length);
          break;

        case 'signed_byte_half_degree':
          // Special encoding: bit 7 = 0.5, bits 0-6 = integer part
          encodedBytes = this.encodeSignedByteHalfDegree(scaledValue);
          break;

        case 'none':
        default:
          // Standard binary encoding
          encodedBytes = this.encodeInteger(Math.round(scaledValue), length, endian);
          break;
      }

      // Extend command array if needed to fit the encoded bytes
      const requiredLength = valueOffset + encodedBytes.length;
      while (command.length < requiredLength) {
        command.push(0);
      }

      // Insert encoded bytes into command
      for (let i = 0; i < encodedBytes.length; i++) {
        command[valueOffset + i] = encodedBytes[i];
      }
    }

    return command;
  }

  /**
   * Encodes a number as BCD (Binary Coded Decimal).
   * Each byte contains two decimal digits (high nibble and low nibble).
   */
  private encodeBcd(value: number, length: number): number[] {
    const result: number[] = new Array(length).fill(0);
    let remaining = Math.abs(value);

    for (let i = length - 1; i >= 0 && remaining > 0; i--) {
      const lowDigit = remaining % 10;
      remaining = Math.floor(remaining / 10);
      const highDigit = remaining % 10;
      remaining = Math.floor(remaining / 10);
      result[i] = (highDigit << 4) | lowDigit;
    }

    return result;
  }

  /**
   * Encodes a number as ASCII string bytes.
   */
  private encodeAscii(value: number, length: number): number[] {
    const str = String(value).padStart(length, '0').slice(-length);
    return str.split('').map((c) => c.charCodeAt(0));
  }

  /**
   * Encodes a temperature value using signed byte with half-degree flag.
   * Bit 7: 0.5 degree flag, Bits 0-6: integer part.
   */
  private encodeSignedByteHalfDegree(value: number): number[] {
    const intPart = Math.floor(Math.abs(value)) & 0x7f;
    const hasHalf = Math.abs(value) % 1 >= 0.25; // 0.5 threshold
    let byte = intPart;
    if (hasHalf) {
      byte |= 0x80; // Set bit 7 for 0.5
    }
    return [byte];
  }

  /**
   * Encodes an integer into bytes with specified length and endianness.
   */
  private encodeInteger(value: number, length: number, endian: string): number[] {
    const result: number[] = new Array(length).fill(0);

    if (length === 1) {
      result[0] = value & 0xff;
    } else {
      for (let i = 0; i < length; i++) {
        const shift = endian === 'little' ? i * 8 : (length - 1 - i) * 8;
        result[i] = (value >> shift) & 0xff;
      }
    }

    return result;
  }
}
