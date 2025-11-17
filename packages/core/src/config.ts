// packages/core/src/config.ts

export type ChecksumType = 'add' | 'xor' | 'add_no_header' | 'xor_no_header' | 'custom' | 'none';
export type ParityType = 'none' | 'even' | 'odd';
export type EndianType = 'big' | 'little';
export type DecodeEncodeType = 'none' | 'bcd' | 'ascii' | 'signed_byte_half_degree' | 'multiply' | 'add_0x80';

export interface SerialConfig {
  baud_rate: number;
  data_bits: 8 | 7 | 6 | 5;
  parity: ParityType;
  stop_bits: 1 | 2;
}

export interface PacketDefaults {
  rx_length?: number;
  rx_timeout?: string; // e.g., "10ms"
  tx_delay?: string;   // e.g., "50ms"
  tx_timeout?: string; // e.g., "500ms"
  tx_retry_cnt?: number;
  rx_header?: number[];
  rx_footer?: number[];
  tx_header?: number[];
  tx_footer?: number[];
  rx_checksum?: ChecksumType | { type: 'custom', algorithm: string }; // algorithm would describe the custom logic
  tx_checksum?: ChecksumType | { type: 'custom', algorithm: string }; // algorithm would describe the custom logic
}

export interface StateSchema {
  data?: number[]; // Byte pattern to match
  mask?: number | number[]; // Mask to apply to data
  offset?: number; // Starting offset within packet data
  inverted?: boolean;
}

export interface StateNumSchema {
  offset?: number;
  length?: number;
  precision?: number;
  signed?: boolean;
  endian?: EndianType;
  decode?: DecodeEncodeType;
  mapping?: { [byteValue: number]: number }; // Added mapping as an optional property
  homenet_logic?: StateLambdaConfig; // New field for structured lambda
}

export interface ValueSource {
  type: 'input' | 'entity_state' | 'packet'; // Added 'packet' type
  entityId?: string; // Required if type is 'entity_state'
  property?: string; // e.g., 'target_temperature', 'is_on'. Required if type is 'entity_state'
  // For 'packet' type, offset, length, etc. are handled by the intersection type in StateLambdaConfig
}

export interface Extractor {
  type: 'check_value' | 'offset_value';
  offset?: number; // For offset_value and check_value
  value?: number; // For check_value
  length?: number; // For offset_value
  precision?: number; // For offset_value
  signed?: boolean; // For offset_value
  endian?: EndianType; // For offset_value
  decode?: DecodeEncodeType; // For offset_value
}

export interface ValueMapping {
  map: number | string | boolean;
  value: number | string | boolean;
}

export interface Condition {
  entityId?: string;
  property?: string;
  value?: any;
  extractor?: Extractor;
}

export interface ValueInsertion {
  valueSource?: ValueSource;
  valueOffset: number;
  valueEncode?: DecodeEncodeType;
  valueMappings?: ValueMapping[];
  length?: number;
  signed?: boolean;
  endian?: EndianType;
  value?: number | string | boolean; // For constant values
}

export interface CommandLambdaConfig {
  type: 'command_lambda'; // Discriminator for type checking
  valueSource?: ValueSource; // This will be for the primary value if not in valueInsertions
  packetTemplates: {
    data: number[];
    ack?: number[];
    conditions?: Condition[]; // Conditions for this specific packet template
    valueInsertions?: ValueInsertion[]; // Array of values to insert
  }[];
  conditions?: { // Conditions for selecting a CommandLambdaConfig
    entityId: string;
    property: string; // e.g., 'is_on'
    value: any; // The value to compare against
    then: CommandLambdaConfig; // Nested lambda config
    else?: CommandLambdaConfig;
  }[];
}

export interface StateLambdaConfig {
  type: 'state_lambda'; // Discriminator for type checking
  valueSource?: ValueSource & { offset?: number; length?: number; precision?: number; signed?: boolean; endian?: EndianType; decode?: DecodeEncodeType; }; // Added properties for packet valueSource
  valueMappings?: ValueMapping[]; // For enum-like values
  conditions?: {
    extractor?: Extractor;
    value?: any; // The value to compare against
    then: any; // The value to return if condition is true
    else?: any; // The value to return if condition is false
  }[];
}

export interface CommandSchema {
  cmd?: number[]; // Byte pattern for the command
  ack?: number[]; // Expected ACK packet data
  mask?: number | number[]; // Mask to apply to cmd
  value_offset?: number; // Offset for value insertion in command
  value_encode?: DecodeEncodeType; // Encoding for the value
  multiply_factor?: number; // Factor to multiply the value by before encoding
  length?: number; // Length of the value in bytes, needed for encoding
  signed?: boolean; // Whether the value is signed, needed for encoding
  endian?: EndianType; // Byte order for the value, needed for encoding
  homenet_logic?: CommandLambdaConfig; // New field for structured lambda
}

export interface EntityPacketParameters extends PacketDefaults {
  // Entity-specific overrides for packet defaults
}

export interface LightEntity {
  type: 'light';
  id: string;
  name: string;
  packet_parameters?: EntityPacketParameters;
  state?: StateSchema;
  state_on: StateSchema;
  state_off: StateSchema;
  command_on: CommandSchema;
  command_off: CommandSchema;
  state_brightness?: StateNumSchema;
  command_brightness?: CommandSchema;
  command_update?: CommandSchema;
}

export interface ClimateEntity {
  type: 'climate';
  id: string;
  name: string;
  packet_parameters?: EntityPacketParameters;
  visual?: {
    min_temperature?: number;
    max_temperature?: number;
    temperature_step?: number;
  };
  state?: StateSchema;
  state_temperature_current?: StateNumSchema;
  state_temperature_target?: StateNumSchema;
  state_off: StateSchema;
  state_heat?: StateSchema;
  state_cool?: StateSchema;
  command_off?: CommandSchema;
  command_heat?: CommandSchema;
  command_cool?: CommandSchema;
  command_temperature?: CommandSchema;
  command_update?: CommandSchema;
}

export interface ValveEntity {
  type: 'valve';
  id: string;
  name: string;
  packet_parameters?: EntityPacketParameters;
  state?: StateSchema;
  state_open: StateSchema;
  state_closed: StateSchema;
  command_open?: CommandSchema;
  command_close?: CommandSchema;
  command_update?: CommandSchema;
}

export interface ButtonEntity {
  type: 'button';
  id: string;
  name: string;
  packet_parameters?: EntityPacketParameters;
  command_press: CommandSchema;
}

export interface SensorEntity {
  type: 'sensor';
  id: string;
  name: string;
  packet_parameters?: EntityPacketParameters;
  state?: StateSchema;
  state_number?: StateNumSchema;
  command_update?: CommandSchema;
}

export interface FanEntity {
  type: 'fan';
  id: string;
  name: string;
  packet_parameters?: EntityPacketParameters;
  state?: StateSchema;
  state_on: StateSchema;
  state_off: StateSchema;
  command_on: CommandSchema;
  command_off: CommandSchema;
  command_speed?: CommandSchema;
  state_speed?: StateNumSchema; // Now StateNumSchema can have mapping
  command_update?: CommandSchema;
}

export interface SwitchEntity {
  type: 'switch';
  id: string;
  name: string;
  packet_parameters?: EntityPacketParameters;
  state?: StateSchema;
  state_on: StateSchema;
  state_off: StateSchema;
  command_on: CommandSchema;
  command_off: CommandSchema;
  command_update?: CommandSchema;
}

export interface BinarySensorEntity {
  type: 'binary_sensor';
  id: string;
  name: string;
  packet_parameters?: EntityPacketParameters;
  state?: StateSchema;
  state_on: StateSchema;
  state_off: StateSchema;
  command_update?: CommandSchema;
}

export type EntityConfig = LightEntity | ClimateEntity | ValveEntity | ButtonEntity | SensorEntity | FanEntity | SwitchEntity | BinarySensorEntity;



export interface HomenetBridgeConfig {
  serial: SerialConfig;
  packet_defaults?: PacketDefaults;
  light?: LightEntity[];
  climate?: ClimateEntity[];
  valve?: ValveEntity[];
  button?: ButtonEntity[];
  sensor?: SensorEntity[];
  fan?: FanEntity[];
  switch?: SwitchEntity[];
  binary_sensor?: BinarySensorEntity[];
}