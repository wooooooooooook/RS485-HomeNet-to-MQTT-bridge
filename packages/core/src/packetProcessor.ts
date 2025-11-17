// packages/core/src/packetProcessor.ts

import {
  HomenetBridgeConfig,
  PacketDefaults,
  EntityConfig,
  CommandSchema,
  StateSchema,
  StateNumSchema,
  ChecksumType,
  DecodeEncodeType,
  EndianType,
  LightEntity,
  ClimateEntity,
  ValveEntity,
  ButtonEntity,
  SensorEntity,
  FanEntity,
  SwitchEntity,
  BinarySensorEntity,
  CommandLambdaConfig, // Import new lambda config interfaces
  StateLambdaConfig,
  ValueSource,
  Extractor
} from './config.js';

export interface EntityStateProvider {
  getLightState(entityId: string): { isOn: boolean } | undefined;
  getClimateState(entityId: string): { targetTemperature: number } | undefined;
  // Add other entity types as needed
}

export class PacketProcessor {
  private config: HomenetBridgeConfig;
  private stateProvider: EntityStateProvider;

  constructor(config: HomenetBridgeConfig, stateProvider: EntityStateProvider) {
    this.config = config;
    this.stateProvider = stateProvider;
  }

  // Utility to convert hex string to byte array
  private hexToBytes(hex: string): number[] {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
  }

  // Utility to convert byte array to hex string
  private bytesToHex(bytes: number[]): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // --- Checksum Calculation Logic ---
  private calculateChecksum(
    data: number[],
    checksumType: ChecksumType | { type: 'custom'; algorithm: string },
    header: number[] = [],
    footer: number[] = []
  ): number[] {
    if (typeof checksumType === 'object' && checksumType.type === 'custom') {
      // For custom checksums, we'll need a more sophisticated interpreter
      // For now, we'll just return an empty array or throw an error
      console.warn(`Custom checksum algorithm '${checksumType.algorithm}' not yet implemented.`);
      return [];
    }

    let checksum = 0;
    let bytesToChecksum: number[] = [];

    switch (checksumType) {
      case 'add':
        bytesToChecksum = [...header, ...data, ...footer];
        let sum = 0;
        for (const byte of bytesToChecksum) {
          sum = (sum + byte) & 0xFF;
        }
        checksum = -sum & 0xff; // Two's complement negation
        break;
      case 'xor':
        bytesToChecksum = [...header, ...data, ...footer];
        for (const byte of bytesToChecksum) {
          checksum ^= byte;
        }
        break;
      case 'add_no_header':
        bytesToChecksum = [...data, ...footer];
        for (const byte of bytesToChecksum) {
          checksum = (checksum + byte) & 0xFF;
        }
        break;
      case 'xor_no_header':
        bytesToChecksum = [...data, ...footer];
        for (const byte of bytesToChecksum) {
          checksum ^= byte;
        }
        break;
      case 'none':
      default:
        return []; // No checksum
    }
    return [checksum];
  }

  // --- Value Encoding/Decoding Logic ---
  private decodeValue(
    bytes: number[],
    schema: StateNumSchema
  ): number | string | null {
    const { offset, length = 1, precision = 0, signed = false, endian = 'big', decode = 'none' } = schema;

    if (offset === undefined || offset + length > bytes.length) { // Check offset for undefined
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
          value = value * 100 + ((valueBytes[i] >> 4) * 10) + (valueBytes[i] & 0x0F);
        }
        break;
      case 'ascii':
        return String.fromCharCode(...valueBytes);
      case 'signed_byte_half_degree':
        // Custom logic for signed byte with 0.5 degree precision
        // Assuming the byte is like 0x80 for 0.5, 0x81 for 1.5, 0x01 for 1.0
        // This is a simplified interpretation, actual logic might be more complex
        value = valueBytes[0] & 0x7F; // Get the magnitude
        if ((valueBytes[0] & 0x80) !== 0) { // Check for 0.5 degree bit
          value += 0.5;
        }
        if (signed && (valueBytes[0] & 0x40) !== 0) { // Assuming a sign bit if needed
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

    if (signed && (valueBytes[0] & 0x80) !== 0 && decode === 'none') { // Generic signed interpretation
        // Handle two's complement for generic signed numbers
        const signBit = 1 << (length * 8 - 1);
        if ((value & signBit) !== 0) {
            value = value - (2 * signBit);
        }
    }

    return precision > 0 ? parseFloat(value.toFixed(precision)) : value;
  }

  private encodeValue(
    value: number | string,
    schema: CommandSchema
  ): number[] {
    const { value_encode = 'none', length = 1, signed = false, endian = 'big', multiply_factor } = schema;

    let encodedBytes: number[] = [];

    if (typeof value === 'string') {
      if (value_encode === 'ascii') {
        encodedBytes = Array.from(value).map(char => char.charCodeAt(0));
      } else {
        console.warn(`Cannot encode string value with non-ascii encoding: ${value_encode}`);
        return [];
      }
    } else { // typeof value === 'number'
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
            bcd.unshift(((temp % 100) / 10 << 4) | (temp % 10));
            temp = Math.floor(temp / 100);
          }
          encodedBytes = bcd;
          break;
        case 'signed_byte_half_degree':
            // Custom logic for encoding signed byte with 0.5 degree precision
            let byteValue = Math.floor(Math.abs(numValue));
            if (numValue % 1 !== 0) { // Check for 0.5
                byteValue |= 0x80;
            }
            if (signed && numValue < 0) {
                // Assuming a sign bit, this might need adjustment based on actual protocol
                byteValue |= 0x40; // Example: setting a sign bit
            }
            encodedBytes = [byteValue];
            break;
        case 'none':
        case 'multiply': // Handled before switch
        case 'add_0x80': // Handled before switch
        default:
          // Generic number to byte array conversion
          for (let i = 0; i < length; i++) {
            encodedBytes.unshift(numValue & 0xFF);
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
    inputValue?: number | string
  ): number[][] | null {
    // 1. Evaluate conditions for selecting a packet template
    if (lambdaConfig.conditions && lambdaConfig.conditions.length > 0) {
      for (const condition of lambdaConfig.conditions) {
        // This part needs to be implemented to query actual entity states
        // For now, assume no conditions are met
        console.warn(`[PacketProcessor] Conditional logic for entity state not fully implemented.`);
        // Example:
        // const entityState = this.stateProvider.getSomeState(condition.entityId, condition.property);
        // if (entityState === condition.value) {
        //   return this.evaluateCommandLambda(condition.then, entity, inputValue);
        // } else if (condition.else) {
        //   return this.evaluateCommandLambda(condition.else, entity, inputValue);
        // }
      }
    }

    const packets: number[][] = [];
    for (const template of lambdaConfig.packetTemplates) {
      let packetData = [...template.data];

      // Evaluate conditions for this specific packet template
      if (template.conditions && template.conditions.length > 0) {
        let templateConditionsMet = true;
        for (const condition of template.conditions) {
          let conditionValue: any;
          if (condition.entityId && condition.property) {
            if (condition.property === 'is_on') {
              conditionValue = this.stateProvider.getLightState(condition.entityId)?.isOn;
            } else if (condition.property === 'target_temperature') {
              conditionValue = this.stateProvider.getClimateState(condition.entityId)?.targetTemperature;
            }
            // Add other entity types and properties as needed
          } else if (condition.extractor) {
            // This part needs to be implemented to evaluate extractor conditions
            console.warn(`[PacketProcessor] Extractor conditions not fully implemented.`);
          }

          if (conditionValue !== condition.value) {
            templateConditionsMet = false;
            break;
          }
        }
        if (!templateConditionsMet) {
          continue; // Skip this template if conditions are not met
        }
      }

      // Process valueInsertions
      if (template.valueInsertions) {
        for (const insertion of template.valueInsertions) {
          let finalValue: number | string; // This is what encodeValue expects

          // First, determine the raw value, which can be boolean, number, or string
          let rawValue: number | string | boolean | undefined;
          if (insertion.value !== undefined) {
              rawValue = insertion.value; // Constant value
          } else if (insertion.valueSource) {
              if (insertion.valueSource.type === 'input') {
                  rawValue = inputValue;
              } else if (insertion.valueSource.type === 'entity_state') {
                  const { entityId, property } = insertion.valueSource;
                  if (entityId && property) {
                      if (property === 'is_on') {
                          rawValue = this.stateProvider.getLightState(entityId)?.isOn; // This can be boolean | undefined
                      } else if (property === 'target_temperature') {
                          rawValue = this.stateProvider.getClimateState(entityId)?.targetTemperature; // This can be number | undefined
                      }
                      // Add other entity types and properties as needed
                  }
              }
          }

          if (rawValue === undefined) {
              console.warn(`rawValue is undefined for insertion at offset ${insertion.valueOffset}. Skipping.`);
              continue;
          }

          if (rawValue === undefined) {
              console.warn(`rawValue is undefined for insertion at offset ${insertion.valueOffset}. Skipping.`);
              continue;
          } else if (typeof rawValue === 'boolean') {
              finalValue = rawValue ? 1 : 0;
          } else if (typeof rawValue === 'number') {
              finalValue = rawValue;
          } else if (typeof rawValue === 'string') {
              finalValue = rawValue;
          } else {
              console.warn(`Unsupported rawValue type for encoding: ${typeof rawValue}. Skipping.`);
              continue; // Should not happen if rawValue is not undefined and not boolean/number/string
          }

          const tempCommandSchema: CommandSchema = {
              value_encode: insertion.valueEncode,
              length: insertion.length,
              signed: insertion.signed,
              endian: insertion.endian,
              multiply_factor: (insertion.valueEncode === 'multiply' && typeof finalValue === 'number') ? finalValue : undefined,
          };

          const encodedValue = this.encodeValue(finalValue, tempCommandSchema);

          packetData.splice(insertion.valueOffset, encodedValue.length, ...encodedValue);
        }
      }
      packets.push(packetData);
    }

    return packets.length > 0 ? packets : null;
  }

  private evaluateStateLambda(
    lambdaConfig: StateLambdaConfig,
    packetData: number[]
  ): number | string | boolean | undefined {
    // 1. Evaluate conditions
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

    // 2. Evaluate valueSource and apply valueMappings
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
        if (decoded !== null) { // Handle null case
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
          // Add other entity types and properties as needed
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

  // --- Packet Construction ---
  public constructCommandPacket(
    entity: EntityConfig,
    commandName: string, // e.g., 'command_on', 'command_off', 'command_press', 'command_temperature'
    value?: number | string // Value for commands like set_temperature, set_speed
  ): number[] | null {
    const packetDefaults = { ...this.config.packet_defaults, ...entity.packet_parameters };

    let commandSchema: CommandSchema | undefined;

    // Handle specific command types
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
      else if (commandName === 'command_temperature') commandSchema = climateEntity.command_temperature;
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
      console.error(`Command schema not found for ${entity.type}.${commandName}`);
      return null;
    }

    // If homenet_logic is defined, use it to construct the packet
    if (commandSchema.homenet_logic) {
      const packets = this.evaluateCommandLambda(commandSchema.homenet_logic, entity, value);
      // For now, return the first packet if multiple are generated
      return packets && packets.length > 0 ? packets[0] : null;
    }

    // Existing logic for direct command data
    if (!commandSchema.cmd) {
      console.error(`Command data (cmd) not found for ${entity.type}.${commandName}`);
      return null;
    }
    let commandData = [...commandSchema.cmd];

    // Insert value if provided and schema supports it
    if (value !== undefined && commandSchema.value_offset !== undefined) {
      const encodedValue = this.encodeValue(value, commandSchema);
      commandData.splice(commandSchema.value_offset, encodedValue.length, ...encodedValue);
    }

    const txHeader = packetDefaults.tx_header || [];
    const txFooter = packetDefaults.tx_footer || [];
    const txChecksum = (packetDefaults.tx_checksum || 'none') as ChecksumType; // Cast to ChecksumType

    const checksumBytes = this.calculateChecksum(commandData, txChecksum, txHeader, txFooter);

    return [...txHeader, ...commandData, ...checksumBytes, ...txFooter];
  }

  // --- Packet Parsing ---
  public parseIncomingPacket(
    packet: number[],
    allEntities: EntityConfig[]
  ): { entityId: string; state: any }[] {
    const parsedStates: { entityId: string; state: any }[] = [];

    for (const entity of allEntities) {
      const packetDefaults = { ...this.config.packet_defaults, ...entity.packet_parameters };

      const rxHeader = packetDefaults.rx_header || [];
      const rxFooter = packetDefaults.rx_footer || [];
      const rxChecksum = (packetDefaults.rx_checksum || 'none') as ChecksumType; // Cast to ChecksumType

      // Basic header check
      if (rxHeader.length > 0 && !this.startsWith(packet, rxHeader)) {
        continue;
      }

      // Remove header for checksum calculation and data extraction
      const dataWithoutHeader = packet.slice(rxHeader.length);

      // Basic footer check (if footer is defined)
      if (rxFooter.length > 0 && !this.endsWith(dataWithoutHeader, rxFooter)) {
        continue;
      }

      // Remove footer for checksum calculation and data extraction
      const dataWithoutHeaderAndFooter = rxFooter.length > 0 ? dataWithoutHeader.slice(0, -rxFooter.length) : dataWithoutHeader;

      // Checksum verification (if checksum is defined)
      if (rxChecksum !== 'none') {
        // This is more complex as checksum is usually at the end of data or before footer
        // For simplicity, let's assume checksum is the last byte before footer
        const expectedChecksumBytes = this.calculateChecksum(
            dataWithoutHeaderAndFooter.slice(0, -1), // Assuming last byte is checksum
            rxChecksum,
            rxHeader,
            [] // Footer already removed
        );
        if (expectedChecksumBytes.length > 0 && expectedChecksumBytes[0] !== dataWithoutHeaderAndFooter[dataWithoutHeaderAndFooter.length - 1]) {
            // console.warn('Checksum mismatch for packet:', this.bytesToHex(packet));
            continue;
        }
        // Remove checksum byte from data for state extraction
        dataWithoutHeaderAndFooter.pop();
      }


      // --- State Extraction Logic ---
      let currentState: { [key: string]: any } = {};
      let matched = false;

      // Check specific states (on/off, heat/cool, etc.)
      if (entity.type === 'light') {
        const lightEntity = entity as LightEntity;
        if (lightEntity.state && this.matchState(dataWithoutHeaderAndFooter, lightEntity.state)) {
          matched = true;
          if (lightEntity.state_on && this.matchState(dataWithoutHeaderAndFooter, lightEntity.state_on)) {
            currentState.isOn = true;
          } else if (lightEntity.state_off && this.matchState(dataWithoutHeaderAndFooter, lightEntity.state_off)) {
            currentState.isOn = false;
          }
        }
      } else if (entity.type === 'switch') {
        const switchEntity = entity as SwitchEntity;
        if (switchEntity.state && this.matchState(dataWithoutHeaderAndFooter, switchEntity.state)) {
          matched = true;
          if (switchEntity.state_on && this.matchState(dataWithoutHeaderAndFooter, switchEntity.state_on)) {
            currentState.isOn = true;
          } else if (switchEntity.state_off && this.matchState(dataWithoutHeaderAndFooter, switchEntity.state_off)) {
            currentState.isOn = false;
          }
        }
      } else if (entity.type === 'valve') {
        const valveEntity = entity as ValveEntity;
        if (valveEntity.state && this.matchState(dataWithoutHeaderAndFooter, valveEntity.state)) {
          matched = true;
          if (valveEntity.state_open && this.matchState(dataWithoutHeaderAndFooter, valveEntity.state_open)) {
            currentState.isOpen = true;
          } else if (valveEntity.state_closed && this.matchState(dataWithoutHeaderAndFooter, valveEntity.state_closed)) {
            currentState.isOpen = false;
          }
        }
      } else if (entity.type === 'climate') {
        const climateEntity = entity as ClimateEntity;
        // Only proceed if the packet matches the primary state identifier for this entity
        if (climateEntity.state && this.matchState(dataWithoutHeaderAndFooter, climateEntity.state)) {
          matched = true;

          // Now that we've matched the entity, extract its specific state properties
          if (climateEntity.state_off && this.matchState(dataWithoutHeaderAndFooter, climateEntity.state_off)) {
            currentState.mode = 'off';
          } else if (climateEntity.state_heat && this.matchState(dataWithoutHeaderAndFooter, climateEntity.state_heat)) {
            currentState.mode = 'heat';
          } else if (climateEntity.state_cool && this.matchState(dataWithoutHeaderAndFooter, climateEntity.state_cool)) {
            currentState.mode = 'cool';
          }

          if (climateEntity.state_temperature_current) {
            currentState.currentTemperature = this.decodeValue(
              dataWithoutHeaderAndFooter,
              climateEntity.state_temperature_current
            );
          }
          if (climateEntity.state_temperature_target) {
            currentState.targetTemperature = this.decodeValue(
              dataWithoutHeaderAndFooter,
              climateEntity.state_temperature_target
            );
          }
        }
      } else if (entity.type === 'sensor') {
        const sensorEntity = entity as SensorEntity;
        if (sensorEntity.state && this.matchState(dataWithoutHeaderAndFooter, sensorEntity.state)) {
          matched = true;
          if (sensorEntity.state_number) {
            currentState.value = this.decodeValue(dataWithoutHeaderAndFooter, sensorEntity.state_number);
          }
        }
      } else if (entity.type === 'fan') {
        const fanEntity = entity as FanEntity;
        if (fanEntity.state && this.matchState(dataWithoutHeaderAndFooter, fanEntity.state)) {
          matched = true;

          if (fanEntity.state_on && this.matchState(dataWithoutHeaderAndFooter, fanEntity.state_on)) {
            currentState.isOn = true;
          } else if (fanEntity.state_off && this.matchState(dataWithoutHeaderAndFooter, fanEntity.state_off)) {
            currentState.isOn = false;
          }

          if (fanEntity.state_speed) {
            if (fanEntity.state_speed.homenet_logic) {
              currentState.speed = this.evaluateStateLambda(
                fanEntity.state_speed.homenet_logic,
                dataWithoutHeaderAndFooter
              );
            } else if (fanEntity.state_speed.mapping) {
              const byteValue = this.decodeValue(dataWithoutHeaderAndFooter, fanEntity.state_speed);
              if (byteValue !== null && typeof byteValue === 'number' && fanEntity.state_speed.mapping[byteValue] !== undefined) {
                currentState.speed = fanEntity.state_speed.mapping[byteValue];
              }
            } else if (fanEntity.state_speed.offset !== undefined) {
              currentState.speed = this.decodeValue(dataWithoutHeaderAndFooter, fanEntity.state_speed);
            }
          }
        }
      } else if (entity.type === 'binary_sensor') {
        const binarySensorEntity = entity as BinarySensorEntity;
        if (binarySensorEntity.state && this.matchState(dataWithoutHeaderAndFooter, binarySensorEntity.state)) {
          matched = true;
          if (binarySensorEntity.state_on && this.matchState(dataWithoutHeaderAndFooter, binarySensorEntity.state_on)) {
            currentState.isOn = true;
          } else if (binarySensorEntity.state_off && this.matchState(dataWithoutHeaderAndFooter, binarySensorEntity.state_off)) {
            currentState.isOn = false;
          }
        }
      }


      if (matched) {
        parsedStates.push({ entityId: entity.id, state: currentState });
      }
    }

    return parsedStates;
  }

  private matchState(packetData: number[], stateSchema: StateSchema): boolean {
    const { data, mask, offset = 0, inverted = false } = stateSchema;

    if (!data || data.length === 0) {
      // 데이터 패턴이 지정되지 않은 경우 다른 조건이 충족되면 일치하는 것으로 간주
      return true;
    }

    if (offset + data.length > packetData.length) {
      return false; // 패턴이 패킷 데이터를 넘어 확장됨
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