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
import { StateSchema, StateNumSchema, ChecksumType, ProtocolConfig } from '../types.js';
import { bytesToHex } from '../utils/common.js';
import { calculateChecksum } from '../utils/checksum.js';
import { EntityStateProvider } from '../packet-processor.js';
import { GenericDevice } from '../devices/generic.device.js';
import { LightDevice } from '../devices/light.device.js';
import { ClimateDevice } from '../devices/climate.device.js';
import { FanDevice } from '../devices/fan.device.js';
import { SwitchDevice } from '../devices/switch.device.js';
import { SensorDevice } from '../devices/sensor.device.js';
import { BinarySensorDevice } from '../devices/binary-sensor.device.js';
import { ValveDevice } from '../devices/valve.device.js';
import { NumberDevice } from '../devices/number.device.js';

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

  /**
   * Validate packet against entity configuration
   * Returns validation result and extracted data without header/footer/checksum
   */
  private validatePacket(
    packet: number[],
    entity: EntityConfig,
  ): {
    valid: boolean;
    dataWithoutHeaderAndFooter: number[];
    checksumValid: boolean;
  } {
    const packetDefaults = { ...this.config.packet_defaults, ...entity.packet_parameters };
    const rxHeader = packetDefaults.rx_header || [];
    const rxFooter = packetDefaults.rx_footer || [];
    const rxChecksum = (packetDefaults.rx_checksum || 'none') as ChecksumType;

    // Header check
    if (rxHeader.length > 0 && !this.startsWith(packet, rxHeader)) {
      return { valid: false, dataWithoutHeaderAndFooter: [], checksumValid: false };
    }

    // Remove header
    let data = packet.slice(rxHeader.length);

    // Footer check
    if (rxFooter.length > 0 && !this.endsWith(data, rxFooter)) {
      return { valid: false, dataWithoutHeaderAndFooter: [], checksumValid: false };
    }

    // Remove footer
    data = rxFooter.length > 0 ? data.slice(0, -rxFooter.length) : data;

    // Checksum validation
    let checksumValid = false;
    if (rxChecksum !== 'none') {
      const headerPart = Buffer.from(rxHeader);
      const dataPart = Buffer.from(data.slice(0, -1));
      const calculatedChecksum = calculateChecksum(headerPart, dataPart, rxChecksum);

      if (calculatedChecksum !== data[data.length - 1]) {
        return { valid: false, dataWithoutHeaderAndFooter: [], checksumValid: false };
      }
      checksumValid = true;
      data = data.slice(0, -1); // Remove checksum byte
    } else {
      checksumValid = true;
    }

    return { valid: true, dataWithoutHeaderAndFooter: data, checksumValid };
  }

  /**
   * Create appropriate Device instance based on entity type
   */
  private createDevice(entity: EntityConfig): GenericDevice {
    const protocolConfig: ProtocolConfig = {
      packet_defaults: this.config.packet_defaults,
    };

    // Use 'as any' to bypass strict type checking since we know the entity type is correct
    switch (entity.type) {
      case 'light':
        return new LightDevice(entity as any, protocolConfig);
      case 'climate':
        return new ClimateDevice(entity as any, protocolConfig);
      case 'fan':
        return new FanDevice(entity as any, protocolConfig);
      case 'switch':
        return new SwitchDevice(entity as any, protocolConfig);
      case 'sensor':
        return new SensorDevice(entity as any, protocolConfig);
      case 'binary_sensor':
        return new BinarySensorDevice(entity as any, protocolConfig);
      case 'valve':
        return new ValveDevice(entity as any, protocolConfig);
      case 'number':
        return new NumberDevice(entity as any, protocolConfig);
      default:
        return new GenericDevice(entity, protocolConfig);
    }
  }

  public parseIncomingPacket(
    packet: number[],
    allEntities: EntityConfig[],
  ): { parsedStates: { entityId: string; state: any }[]; checksumValid: boolean } {
    const parsedStates: { entityId: string; state: any }[] = [];
    let anyChecksumValid = false;

    console.log(
      `[PacketParser] Parsing packet: [${packet.map((b) => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`,
    );

    for (const entity of allEntities) {
      console.log(`[PacketParser] Checking entity: ${entity.id} (${entity.type})`);

      // Validate packet against entity configuration
      const validation = this.validatePacket(packet, entity);
      if (!validation.valid) {
        continue;
      }

      console.log(`[PacketParser]   ✓ Packet validation passed`);
      anyChecksumValid = anyChecksumValid || validation.checksumValid;

      // Create device and delegate parsing
      const device = this.createDevice(entity);
      const state = device.parseData(packet);

      if (state) {
        console.log(`[PacketParser]   ✓ State parsed:`, state);
        parsedStates.push({ entityId: entity.id, state });
      } else {
        console.log(`[PacketParser]   ✗ No state extracted`);
      }
    }

    return { parsedStates, checksumValid: anyChecksumValid };
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
