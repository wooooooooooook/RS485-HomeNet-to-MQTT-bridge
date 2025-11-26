// packages/core/src/protocol/parsers/packet.parser.ts

import { HomenetBridgeConfig } from '../../config/types.js';
import { EntityConfig, StateLambdaConfig } from '../../domain/entities/base.entity.js';
import { LightEntity } from '../../domain/entities/light.entity.js';
import { ClimateEntity } from '../../domain/entities/climate.entity.js';
import { ValveEntity } from '../../domain/entities/valve.entity.js';
import { SensorEntity } from '../../domain/entities/sensor.entity.js';
import { FanEntity } from '../../domain/entities/fan.entity.js';
import { SwitchEntity } from '../../domain/entities/switch.entity.js';
import { BinarySensorEntity } from '../../domain/entities/binary-sensor.entity.js';
import { StateSchema, StateNumSchema, ChecksumType } from '../types.js';
import { bytesToHex } from '../utils/common.js';
import { calculateChecksum } from '../utils/checksum.js';
import { EntityStateProvider } from '../packet-processor.js';

export class PacketParser {
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
      console.warn('Attempted to decode value outside of packet bounds or offset is undefined.');
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

  private evaluateStateLambda(
    lambdaConfig: StateLambdaConfig,
    packetData: number[],
  ): number | string | boolean | undefined {
    if (lambdaConfig.conditions && lambdaConfig.conditions.length > 0) {
      for (const condition of lambdaConfig.conditions) {
        if (condition.extractor) {
          if (condition.extractor.type === 'check_value') {
            const { offset, value } = condition.extractor;
            if (offset !== undefined && packetData[offset] === value) {
              return condition.then;
            }
          } else if (condition.extractor.type === 'offset_value') {
            const extractedValue = this.decodeValue(packetData, {
              offset: condition.extractor.offset,
              length: condition.extractor.length,
              precision: condition.extractor.precision,
              signed: condition.extractor.signed,
              endian: condition.extractor.endian,
              decode: condition.extractor.decode,
            } as StateNumSchema);
            if (extractedValue === condition.value) {
              return condition.then;
            }
          }
        }
      }
    }

    if (lambdaConfig.valueSource) {
      let resolvedValue: number | string | undefined;
      if (lambdaConfig.valueSource.type === 'packet') {
        const decoded = this.decodeValue(packetData, {
          offset: lambdaConfig.valueSource.offset,
          length: lambdaConfig.valueSource.length,
          precision: lambdaConfig.valueSource.precision,
          signed: lambdaConfig.valueSource.signed,
          endian: lambdaConfig.valueSource.endian,
          decode: lambdaConfig.valueSource.decode,
        } as StateNumSchema);
        if (decoded !== null) {
          resolvedValue = decoded;
        }
      } else if (lambdaConfig.valueSource.type === 'entity_state') {
        const { entityId, property } = lambdaConfig.valueSource;
        if (entityId && property) {
          if (property === 'is_on') {
            resolvedValue = this.stateProvider.getLightState(entityId)?.isOn ? 1 : 0;
          } else if (property === 'target_temperature') {
            resolvedValue = this.stateProvider.getClimateState(entityId)?.targetTemperature;
          }
        }
      }

      if (resolvedValue !== undefined && lambdaConfig.valueMappings) {
        for (const mapping of lambdaConfig.valueMappings) {
          if (mapping.map === resolvedValue) {
            return mapping.value;
          }
        }
      }
    }

    return undefined;
  }

  public parseIncomingPacket(
    packet: number[],
    allEntities: EntityConfig[],
  ): { parsedStates: { entityId: string; state: any }[]; checksumValid: boolean } {
    const parsedStates: { entityId: string; state: any }[] = [];
    let checksumValid = false;

    console.log(
      `[PacketParser] Parsing packet: [${packet.map((b) => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`,
    );

    for (const entity of allEntities) {
      const packetDefaults = { ...this.config.packet_defaults, ...entity.packet_parameters };

      const rxHeader = packetDefaults.rx_header || [];
      const rxFooter = packetDefaults.rx_footer || [];
      const rxChecksum = (packetDefaults.rx_checksum || 'none') as ChecksumType;

      console.log(`[PacketParser] Checking entity: ${entity.id} (${entity.type})`);

      if (rxHeader.length > 0 && !this.startsWith(packet, rxHeader)) {
        // console.log(`[PacketParser]   ✗ Header mismatch - expected: [${rxHeader.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        continue;
      }

      const dataWithoutHeader = packet.slice(rxHeader.length);

      if (rxFooter.length > 0 && !this.endsWith(dataWithoutHeader, rxFooter)) {
        // console.log(`[PacketParser]   ✗ Footer mismatch - expected: [${rxFooter.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        continue;
      }

      let dataWithoutHeaderAndFooter =
        rxFooter.length > 0 ? dataWithoutHeader.slice(0, -rxFooter.length) : dataWithoutHeader;

      // Validate checksum if required
      if (rxChecksum !== 'none') {
        const bytesToChecksum = [...rxHeader, ...dataWithoutHeaderAndFooter.slice(0, -1)];
        const calculatedChecksum = calculateChecksum(Buffer.from(bytesToChecksum), rxChecksum);

        if (
          calculatedChecksum !== dataWithoutHeaderAndFooter[dataWithoutHeaderAndFooter.length - 1]
        ) {
          console.log(
            `[PacketParser]   ✗ Checksum mismatch - expected: 0x${calculatedChecksum.toString(16).padStart(2, '0')}, got: 0x${dataWithoutHeaderAndFooter[dataWithoutHeaderAndFooter.length - 1].toString(16).padStart(2, '0')}`,
          );
          continue;
        }
        console.log(`[PacketParser]   ✓ Checksum valid`);
        checksumValid = true;
        // Remove checksum byte for state extraction (create a copy to avoid mutation)
        dataWithoutHeaderAndFooter = dataWithoutHeaderAndFooter.slice(0, -1);
      } else {
        // If no checksum is required, we consider it valid in terms of checksum
        checksumValid = true;
      }

      console.log(
        `[PacketParser]   Data for matching: [${dataWithoutHeaderAndFooter.map((b: number) => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`,
      );

      // --- State Extraction Logic ---
      let currentState: { [key: string]: any } = {};
      let matched = false;

      if (entity.type === 'light') {
        const lightEntity = entity as LightEntity;
        if (lightEntity.state && this.matchState(dataWithoutHeaderAndFooter, lightEntity.state)) {
          console.log(`[PacketParser]   ✓ State matched for light entity`);
          matched = true;
          if (
            lightEntity.state_on &&
            this.matchState(dataWithoutHeaderAndFooter, lightEntity.state_on)
          ) {
            currentState.isOn = true;
          } else if (
            lightEntity.state_off &&
            this.matchState(dataWithoutHeaderAndFooter, lightEntity.state_off)
          ) {
            currentState.isOn = false;
          }
        } else if (lightEntity.state) {
          console.log(`[PacketParser]   ✗ State mismatch for light entity`);
        }
      } else if (entity.type === 'switch') {
        const switchEntity = entity as SwitchEntity;
        if (switchEntity.state && this.matchState(dataWithoutHeaderAndFooter, switchEntity.state)) {
          matched = true;
          if (
            switchEntity.state_on &&
            this.matchState(dataWithoutHeaderAndFooter, switchEntity.state_on)
          ) {
            currentState.isOn = true;
          } else if (
            switchEntity.state_off &&
            this.matchState(dataWithoutHeaderAndFooter, switchEntity.state_off)
          ) {
            currentState.isOn = false;
          }
        }
      } else if (entity.type === 'valve') {
        const valveEntity = entity as ValveEntity;
        if (valveEntity.state && this.matchState(dataWithoutHeaderAndFooter, valveEntity.state)) {
          matched = true;
          if (
            valveEntity.state_open &&
            this.matchState(dataWithoutHeaderAndFooter, valveEntity.state_open)
          ) {
            currentState.isOpen = true;
          } else if (
            valveEntity.state_closed &&
            this.matchState(dataWithoutHeaderAndFooter, valveEntity.state_closed)
          ) {
            currentState.isOpen = false;
          }
        }
      } else if (entity.type === 'climate') {
        const climateEntity = entity as ClimateEntity;
        if (
          climateEntity.state &&
          this.matchState(dataWithoutHeaderAndFooter, climateEntity.state)
        ) {
          matched = true;

          if (
            climateEntity.state_off &&
            this.matchState(dataWithoutHeaderAndFooter, climateEntity.state_off)
          ) {
            currentState.mode = 'off';
          } else if (
            climateEntity.state_heat &&
            this.matchState(dataWithoutHeaderAndFooter, climateEntity.state_heat)
          ) {
            currentState.mode = 'heat';
          } else if (
            climateEntity.state_cool &&
            this.matchState(dataWithoutHeaderAndFooter, climateEntity.state_cool)
          ) {
            currentState.mode = 'cool';
          }

          // Temperature parsing is handled by ClimateDevice, not here
        }
      } else if (entity.type === 'sensor') {
        const sensorEntity = entity as SensorEntity;
        if (sensorEntity.state && this.matchState(dataWithoutHeaderAndFooter, sensorEntity.state)) {
          matched = true;
          if (sensorEntity.state_number) {
            currentState.value = this.decodeValue(
              dataWithoutHeaderAndFooter,
              sensorEntity.state_number,
            );
          }
        }
      } else if (entity.type === 'fan') {
        const fanEntity = entity as FanEntity;
        if (fanEntity.state && this.matchState(dataWithoutHeaderAndFooter, fanEntity.state)) {
          matched = true;

          if (
            fanEntity.state_on &&
            this.matchState(dataWithoutHeaderAndFooter, fanEntity.state_on)
          ) {
            currentState.isOn = true;
          } else if (
            fanEntity.state_off &&
            this.matchState(dataWithoutHeaderAndFooter, fanEntity.state_off)
          ) {
            currentState.isOn = false;
          }

          if (fanEntity.state_speed) {
            if (fanEntity.state_speed.homenet_logic) {
              currentState.speed = this.evaluateStateLambda(
                fanEntity.state_speed.homenet_logic,
                dataWithoutHeaderAndFooter,
              );
            } else if (fanEntity.state_speed.mapping) {
              const byteValue = this.decodeValue(dataWithoutHeaderAndFooter, fanEntity.state_speed);
              if (
                byteValue !== null &&
                typeof byteValue === 'number' &&
                fanEntity.state_speed.mapping[byteValue] !== undefined
              ) {
                currentState.speed = fanEntity.state_speed.mapping[byteValue];
              }
            } else if (fanEntity.state_speed.offset !== undefined) {
              currentState.speed = this.decodeValue(
                dataWithoutHeaderAndFooter,
                fanEntity.state_speed,
              );
            }
          }
        }
      } else if (entity.type === 'binary_sensor') {
        const binarySensorEntity = entity as BinarySensorEntity;
        if (
          binarySensorEntity.state &&
          this.matchState(dataWithoutHeaderAndFooter, binarySensorEntity.state)
        ) {
          matched = true;
          if (
            binarySensorEntity.state_on &&
            this.matchState(dataWithoutHeaderAndFooter, binarySensorEntity.state_on)
          ) {
            currentState.isOn = true;
          } else if (
            binarySensorEntity.state_off &&
            this.matchState(dataWithoutHeaderAndFooter, binarySensorEntity.state_off)
          ) {
            currentState.isOn = false;
          }
        }
      }

      if (matched) {
        parsedStates.push({ entityId: entity.id, state: currentState });
      }
    }

    return { parsedStates, checksumValid };
  }

  private matchState(packetData: number[], stateSchema: StateSchema): boolean {
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

  private startsWith(array: number[], prefix: number[]): boolean {
    if (prefix.length > array.length) {
      return false;
    }
    for (let i = 0; i < prefix.length; i++) {
      if (array[i] !== prefix[i]) {
        return false;
      }
    }
    return true;
  }

  private endsWith(array: number[], suffix: number[]): boolean {
    if (suffix.length > array.length) {
      return false;
    }
    for (let i = 0; i < suffix.length; i++) {
      if (array[array.length - suffix.length + i] !== suffix[i]) {
        return false;
      }
    }
    return true;
  }
}
