// packages/core/src/protocol/generators/command.generator.ts

import { HomenetBridgeConfig } from '../../config/types.js';
import { EntityConfig, CommandSchema } from '../../domain/entities/base.entity.js';
import { LightEntity } from '../../domain/entities/light.entity.js';
import { ClimateEntity } from '../../domain/entities/climate.entity.js';
import { ValveEntity } from '../../domain/entities/valve.entity.js';
import { ButtonEntity } from '../../domain/entities/button.entity.js';
import { SensorEntity } from '../../domain/entities/sensor.entity.js';
import { FanEntity } from '../../domain/entities/fan.entity.js';
import { SwitchEntity } from '../../domain/entities/switch.entity.js';
import { PacketDefaults, ChecksumType, Checksum2Type, StateNumSchema } from '../types.js';
import { logger } from '../../utils/logger.js';
import { EntityStateProvider } from '../packet-processor.js';
import { calculateChecksum, calculateChecksum2 } from '../utils/checksum.js';
import { CelExecutor } from '../cel-executor.js';
import { Buffer } from 'buffer';

/**
 * Responsible for generating raw byte packets for device commands.
 *
 * This class translates high-level commands (e.g., "turn on", "set temperature 24")
 * into the specific byte sequences required by the hardware protocol, based on
 * the provided Entity Configuration and Command Schemas.
 *
 * Key responsibilities:
 * - Looking up the correct command schema for a given entity and command name.
 * - Encoding values (numbers/strings) into byte arrays (handling BCD, endianness, etc.).
 * - Assembling the full packet with Header, Data, and Footer.
 * - Calculating Checksums (1-byte, 2-byte, or CEL-based).
 */
export class CommandGenerator {
  private config: HomenetBridgeConfig;
  private stateProvider: EntityStateProvider;
  private celExecutor: CelExecutor;

  private readonly checksumTypes = new Set([
    'add',
    'add_no_header',
    'xor',
    'xor_no_header',
    'samsung_rx',
    'samsung_tx',
  ]);

  private readonly checksum2Types = new Set(['xor_add']);

  /**
   * @param config - Global bridge configuration (contains default packet settings like retries, timeouts).
   * @param stateProvider - Interface to access current entity states (needed for CEL checksum calculations).
   */
  constructor(config: HomenetBridgeConfig, stateProvider: EntityStateProvider) {
    this.config = config;
    this.stateProvider = stateProvider;
    this.celExecutor = new CelExecutor();
  }

  // --- Value Encoding/Decoding Logic ---

  /**
   * Decodes a byte sequence into a value based on a schema.
   *
   * @internal
   * @deprecated This method is currently unused in the command generation flow
   *             but is preserved for potential future symmetric use.
   */
  private decodeValue(bytes: number[], schema: StateNumSchema): number | string | null {
    const {
      offset,
      length = 1,
      precision = 0,
      signed = false,
      endian = 'big',
      decode = 'none',
    } = schema;

    if (offset === undefined || offset + length > bytes.length) {
      logger.warn('Attempted to decode value outside of packet bounds or offset is undefined.');
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

    return precision > 0 ? parseFloat(value.toFixed(precision)) : value;
  }

  /**
   * Encodes a high-level value into a byte array according to the command schema.
   *
   * Handles various encoding strategies:
   * - `bcd`: Binary Coded Decimal (e.g., 24 -> 0x24)
   * - `ascii`: String to ASCII bytes
   * - `signed_byte_half_degree`: Special encoding for thermostats (half-degree precision + sign bit)
   * - `add_0x80` / `multiply`: Simple arithmetic transformations
   *
   * @param value - The value to encode (number or string).
   * @param schema - The schema defining how to encode the value.
   * @returns The encoded byte array.
   */
  private encodeValue(value: number | string, schema: CommandSchema): number[] {
    const {
      value_encode = 'none',
      length = 1,
      signed = false,
      endian = 'big',
      multiply_factor,
    } = schema;

    let encodedBytes: number[] = [];

    if (typeof value === 'string') {
      if (value_encode === 'ascii') {
        encodedBytes = Array.from(value).map((char) => char.charCodeAt(0));
      } else {
        logger.warn(`Cannot encode string value with non-ascii encoding: ${value_encode}`);
        return [];
      }
    } else {
      let numValue = value;

      if (value_encode === 'multiply' && typeof multiply_factor === 'number') {
        numValue *= multiply_factor;
      } else if (value_encode === 'add_0x80') {
        numValue += 0x80;
      }

      switch (value_encode) {
        case 'bcd':
          let bcd = [];
          let temp = Math.abs(numValue);
          while (temp > 0) {
            bcd.unshift((((temp % 100) / 10) << 4) | temp % 10);
            temp = Math.floor(temp / 100);
          }
          encodedBytes = bcd;
          break;
        case 'signed_byte_half_degree':
          let byteValue = Math.floor(Math.abs(numValue));
          if (numValue % 1 !== 0) {
            byteValue |= 0x80;
          }
          if (signed && numValue < 0) {
            byteValue |= 0x40;
          }
          encodedBytes = [byteValue];
          break;
        case 'none':
        case 'multiply':
        case 'add_0x80':
        default:
          for (let i = 0; i < length; i++) {
            encodedBytes.unshift(numValue & 0xff);
            numValue >>= 8;
          }
          break;
      }
    }

    if (endian === 'little') {
      encodedBytes.reverse();
    }

    return encodedBytes;
  }

  /**
   * Constructs a complete command packet for a specific entity.
   *
   * This is the main entry point for generating commands. It:
   * 1. Merges global packet defaults with entity-specific `packet_parameters`.
   * 2. Locates the specific `CommandSchema` for the requested `commandName` (e.g., `command_on`).
   * 3. Encodes the optional `value` into the command data.
   * 4. Appends the Header and Footer.
   * 5. Calculates and appends the Checksum (supporting standard 1-byte, 2-byte, and CEL scripts).
   *
   * @param entity - The configuration of the target entity.
   * @param commandName - The specific command to execute (e.g., 'command_on', 'command_temperature').
   * @param value - (Optional) The value to send with the command (e.g., target temperature).
   * @returns The constructed packet as an array of numbers, or `null` if the schema is missing/invalid.
   */
  public constructCommandPacket(
    entity: EntityConfig,
    commandName: string,
    value?: number | string,
  ): number[] | null {
    const packetDefaults = { ...this.config.packet_defaults, ...entity.packet_parameters };

    let commandSchema: CommandSchema | undefined;

    // Entity type checks...
    if (entity.type === 'light') {
      const lightEntity = entity as LightEntity;
      if (commandName === 'command_on') commandSchema = lightEntity.command_on;
      else if (commandName === 'command_off') commandSchema = lightEntity.command_off;
      else if (commandName === 'command_update') commandSchema = lightEntity.command_update;
    } else if (entity.type === 'switch') {
      const switchEntity = entity as SwitchEntity;
      if (commandName === 'command_on') commandSchema = switchEntity.command_on;
      else if (commandName === 'command_off') commandSchema = switchEntity.command_off;
      else if (commandName === 'command_update') commandSchema = switchEntity.command_update;
    } else if (entity.type === 'valve') {
      const valveEntity = entity as ValveEntity;
      if (commandName === 'command_open') commandSchema = valveEntity.command_open;
      else if (commandName === 'command_close') commandSchema = valveEntity.command_close;
      else if (commandName === 'command_update') commandSchema = valveEntity.command_update;
    } else if (entity.type === 'button') {
      const buttonEntity = entity as ButtonEntity;
      if (commandName === 'command_press') commandSchema = buttonEntity.command_press;
    } else if (entity.type === 'climate') {
      const climateEntity = entity as ClimateEntity;
      if (commandName === 'command_off') commandSchema = climateEntity.command_off;
      else if (commandName === 'command_heat') commandSchema = climateEntity.command_heat;
      else if (commandName === 'command_cool') commandSchema = climateEntity.command_cool;
      else if (commandName === 'command_temperature')
        commandSchema = climateEntity.command_temperature;
      else if (commandName === 'command_update') commandSchema = climateEntity.command_update;
    } else if (entity.type === 'fan') {
      const fanEntity = entity as FanEntity;
      if (commandName === 'command_on') commandSchema = fanEntity.command_on;
      else if (commandName === 'command_off') commandSchema = fanEntity.command_off;
      else if (commandName === 'command_speed') commandSchema = fanEntity.command_speed;
      else if (commandName === 'command_update') commandSchema = fanEntity.command_update;
    } else if (entity.type === 'sensor') {
      const sensorEntity = entity as SensorEntity;
      if (commandName === 'command_update') commandSchema = sensorEntity.command_update;
    }

    if (!commandSchema) {
      logger.error(`Command schema not found for ${entity.type}.${commandName}`);
      return null;
    }

    if (!commandSchema.cmd) {
      logger.error(`Command data (cmd) not found for ${entity.type}.${commandName}`);
      return null;
    }
    let commandData = [...commandSchema.cmd];

    if (value !== undefined && commandSchema.value_offset !== undefined) {
      const encodedValue = this.encodeValue(value, commandSchema);
      commandData.splice(commandSchema.value_offset, encodedValue.length, ...encodedValue);
    }

    const txHeader = packetDefaults.tx_header || [];
    const txFooter = packetDefaults.tx_footer || [];

    const headerPart = Buffer.from(txHeader);
    const dataPart = Buffer.from(commandData);

    // Check for 1-byte checksum first
    if (packetDefaults.tx_checksum && packetDefaults.tx_checksum !== 'none') {
      const checksumOrScript = packetDefaults.tx_checksum as string;
      let checksum = 0;

      if (this.checksumTypes.has(checksumOrScript)) {
        checksum = calculateChecksum(
          headerPart,
          dataPart,
          packetDefaults.tx_checksum as ChecksumType,
        );
      } else {
        // CEL Expression for 1-byte checksum
        const fullData = [...txHeader, ...commandData];
        // Pass global states to CEL for context if needed (though checksum usually depends on packet data)
        const result = this.celExecutor.execute(checksumOrScript, {
          data: fullData,
          len: fullData.length,
          states: this.stateProvider.getAllStates ? this.stateProvider.getAllStates() : {}, // Safety check
          state: this.stateProvider.getEntityState
            ? this.stateProvider.getEntityState(entity.id)
            : {},
        });

        if (typeof result === 'number') {
          checksum = result & 0xff;
        } else {
          logger.error(
            `CEL tx_checksum returned invalid result. Expected number, got: ${JSON.stringify(result)}`,
          );
          checksum = 0;
        }
      }

      return [...txHeader, ...commandData, checksum, ...txFooter];
    }

    // Check for 2-byte checksum
    if (packetDefaults.tx_checksum2) {
      let checksum: number[];

      if (typeof packetDefaults.tx_checksum2 === 'string') {
        const checksumOrScript = packetDefaults.tx_checksum2 as string;

        if (this.checksum2Types.has(checksumOrScript)) {
          checksum = calculateChecksum2(headerPart, dataPart, checksumOrScript as Checksum2Type);
        } else {
          // CEL Expression
          const fullData = [...txHeader, ...commandData];
          const result = this.celExecutor.execute(checksumOrScript, {
            data: fullData,
            len: fullData.length,
            states: this.stateProvider.getAllStates ? this.stateProvider.getAllStates() : {},
            state: this.stateProvider.getEntityState
              ? this.stateProvider.getEntityState(entity.id)
              : {},
          });

          // Validate result is array of 2 bytes
          if (Array.isArray(result) && result.length === 2) {
            checksum = result;
          } else {
            logger.error(
              `CEL tx_checksum2 returned invalid result. Expected array of 2 bytes, got: ${JSON.stringify(result)}`,
            );
            checksum = [0, 0];
          }
        }
      } else {
        logger.warn('Unknown tx_checksum2 type');
        checksum = [0, 0];
      }

      return [...txHeader, ...commandData, ...checksum, ...txFooter];
    }

    return [...txHeader, ...commandData, ...txFooter];
  }
}
