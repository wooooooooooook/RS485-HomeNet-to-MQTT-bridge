// packages/core/src/protocol/generators/command.generator.ts

import {
  HomenetBridgeConfig,
} from '../../config/types.js';
import {
  EntityConfig,
  CommandSchema,
  CommandLambdaConfig,
  StateLambdaConfig,
} from '../../domain/entities/base.entity.js';
import { LightEntity } from '../../domain/entities/light.entity.js';
import { ClimateEntity } from '../../domain/entities/climate.entity.js';
import { ValveEntity } from '../../domain/entities/valve.entity.js';
import { ButtonEntity } from '../../domain/entities/button.entity.js';
import { SensorEntity } from '../../domain/entities/sensor.entity.js';
import { FanEntity } from '../../domain/entities/fan.entity.js';
import { SwitchEntity } from '../../domain/entities/switch.entity.js';
import { BinarySensorEntity } from '../../domain/entities/binary-sensor.entity.js';
import {
  PacketDefaults,
  ChecksumType,
  DecodeEncodeType,
  EndianType,
  ValueSource,
  Extractor,
  StateNumSchema,
  StateSchema,
} from '../types.js';
import { logger } from '../../utils/logger.js';
import { EntityStateProvider } from '../packet-processor.js';
import { hexToBytes, bytesToHex } from '../utils/common.js'; // Import utilities
import { calculateChecksum } from '../utils/checksum.js';

export class CommandGenerator {
  private config: HomenetBridgeConfig;
  private stateProvider: EntityStateProvider;

  constructor(config: HomenetBridgeConfig, stateProvider: EntityStateProvider) {
    this.config = config;
    this.stateProvider = stateProvider;
  }

  // --- Value Encoding/Decoding Logic ---
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

  private evaluateCommandLambda(
    lambdaConfig: CommandLambdaConfig,
    entity: EntityConfig,
    inputValue?: number | string,
  ): number[][] | null {
    if (lambdaConfig.conditions && lambdaConfig.conditions.length > 0) {
      for (const condition of lambdaConfig.conditions) {
        logger.warn(`[CommandGenerator] Conditional logic for entity state not fully implemented.`);
      }
    }

    const packets: number[][] = [];
    for (const template of lambdaConfig.packetTemplates) {
      let packetData = [...template.data];

      if (template.conditions && template.conditions.length > 0) {
        let templateConditionsMet = true;
        for (const condition of template.conditions) {
          let conditionValue: any;
          if (condition.entityId && condition.property) {
            if (condition.property === 'is_on') {
              conditionValue = this.stateProvider.getLightState(condition.entityId)?.isOn;
            } else if (condition.property === 'target_temperature') {
              conditionValue = this.stateProvider.getClimateState(
                condition.entityId,
              )?.targetTemperature;
            }
          } else if (condition.extractor) {
            logger.warn(`[CommandGenerator] Extractor conditions not fully implemented.`);
          }

          if (conditionValue !== condition.value) {
            templateConditionsMet = false;
            break;
          }
        }
        if (!templateConditionsMet) {
          continue;
        }
      }

      if (template.valueInsertions) {
        for (const insertion of template.valueInsertions) {
          let finalValue: number | string;

          let rawValue: number | string | boolean | undefined;
          if (insertion.value !== undefined) {
            rawValue = insertion.value;
          } else if (insertion.valueSource) {
            if (insertion.valueSource.type === 'input') {
              rawValue = inputValue;
            } else if (insertion.valueSource.type === 'entity_state') {
              const { entityId, property } = insertion.valueSource;
              if (entityId && property) {
                if (property === 'is_on') {
                  rawValue = this.stateProvider.getLightState(entityId)?.isOn;
                } else if (property === 'target_temperature') {
                  rawValue = this.stateProvider.getClimateState(entityId)?.targetTemperature;
                }
              }
            }
          }

          if (rawValue === undefined) {
            logger.warn(
              `rawValue is undefined for insertion at offset ${insertion.valueOffset}. Skipping.`,
            );
            continue;
          }

          if (typeof rawValue === 'boolean') {
            finalValue = rawValue ? 1 : 0;
          } else if (typeof rawValue === 'number') {
            finalValue = rawValue;
          } else if (typeof rawValue === 'string') {
            finalValue = rawValue;
          } else {
            logger.warn(`Unsupported rawValue type for encoding: ${typeof rawValue}. Skipping.`);
            continue;
          }

          const tempCommandSchema: CommandSchema = {
            value_encode: insertion.valueEncode,
            length: insertion.length,
            signed: insertion.signed,
            endian: insertion.endian,
            multiply_factor:
              insertion.valueEncode === 'multiply' && typeof finalValue === 'number'
                ? finalValue
                : undefined,
          };

          const encodedValue = this.encodeValue(finalValue, tempCommandSchema);

          packetData.splice(insertion.valueOffset, encodedValue.length, ...encodedValue);
        }
      }
      packets.push(packetData);
    }

    return packets.length > 0 ? packets : null;
  }

  public constructCommandPacket(
    entity: EntityConfig,
    commandName: string,
    value?: number | string,
  ): number[] | null {
    const packetDefaults = { ...this.config.packet_defaults, ...entity.packet_parameters };

    let commandSchema: CommandSchema | undefined;

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

    if (commandSchema.homenet_logic) {
      const packets = this.evaluateCommandLambda(commandSchema.homenet_logic, entity, value);
      return packets && packets.length > 0 ? packets[0] : null;
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
    const txChecksum = (packetDefaults.tx_checksum || 'none') as ChecksumType;

    const bytesToChecksum = [...txHeader, ...commandData, ...txFooter];
    const checksum = calculateChecksum(Buffer.from(bytesToChecksum), txChecksum);

    return [...txHeader, ...commandData, checksum, ...txFooter];
  }
}