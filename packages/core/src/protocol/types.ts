/**
 * Controls how an optimistic entity's state is initialized on restart.
 * - ALWAYS_ON: Always initialize to ON/OPEN/UNLOCKED (no restore).
 * - ALWAYS_OFF: Always initialize to OFF/CLOSED/LOCKED (no restore). **Default**.
 * - RESTORE_DEFAULT_ON: Attempt MQTT retained restore; fallback to ON.
 * - RESTORE_DEFAULT_OFF: Attempt MQTT retained restore; fallback to OFF.
 */
export type RestoreMode = 'ALWAYS_ON' | 'ALWAYS_OFF' | 'RESTORE_DEFAULT_ON' | 'RESTORE_DEFAULT_OFF';

/**
 * Supported 1-byte checksum algorithms.
 *
 * - `add`: Sum of all bytes (header + data) & 0xFF.
 * - `add_no_header`: Sum of data bytes (excluding header) & 0xFF.
 * - `add_final(0xNN)`: Sum of all bytes (header + data), then add the configured final byte.
 * - `add_final_no_header(0xNN)`: Sum of data bytes (excluding header), then add the configured final byte.
 * - `xor`: XOR of all bytes (header + data).
 * - `xor_no_header`: XOR of data bytes (excluding header).
 * - `xor_final(0xNN)`: XOR of all bytes (header + data), then XOR with the configured final byte.
 * - `xor_final_no_header(0xNN)`: XOR of data bytes (excluding header), then XOR with the configured final byte.
 * - `samsung_rx`: (@deprecated) Specialized Samsung Wallpad RX checksum (0xB0 ^ XOR). If data[0] < 0x7C, result ^= 0x80.
 * - `samsung_tx`: (@deprecated) Specialized Samsung Wallpad TX checksum.
 * - `samsung_xor`: XOR of all bytes & 0x7F (Msb 0).
 * - `bestin_sum`: Cumulative XOR-based sum algorithm.
 * - `crc8*`: CRC-8 variants. 기본형은 헤더+데이터, `_no_header`는 데이터만.
 * - `none`: No checksum calculation.
 */
export type ChecksumType =
  | 'add'
  | 'xor'
  | 'add_no_header'
  | 'xor_no_header'
  | `add_final(0x${string})`
  | `add_final_no_header(0x${string})`
  | `xor_final(0x${string})`
  | `xor_final_no_header(0x${string})`
  | 'samsung_rx'
  | 'samsung_tx'
  | 'samsung_xor'
  | 'bestin_sum'
  | 'crc8'
  | 'crc8_no_header'
  | 'crc8_maxim'
  | 'crc8_maxim_no_header'
  | 'crc8_rohc'
  | 'crc8_rohc_no_header'
  | 'crc8_wcdma'
  | 'crc8_wcdma_no_header'
  | 'none';

/**
 * Supported 2-byte checksum algorithms.
 *
 * - `xor_add`: 헤더 + 데이터 대상.
 * - 기본 CRC16 이름(`crc16_*`): 헤더 + 데이터 대상.
 * - `_no_header` 접미사 CRC16(`crc16_*_no_header`): 데이터만 대상.
 * - `crc_ccitt_xmodem`: 레거시 alias (`crc16_xmodem_no_header`와 동일 동작).
 */
export type Checksum2Type =
  | 'xor_add'
  | 'crc_ccitt_xmodem'
  | 'crc16_xmodem'
  | 'crc16_xmodem_no_header'
  | 'crc16_ccitt_false'
  | 'crc16_ccitt_false_no_header'
  | 'crc16_modbus'
  | 'crc16_modbus_no_header'
  | 'crc16_ibm'
  | 'crc16_ibm_no_header'
  | 'crc16_kermit'
  | 'crc16_kermit_no_header'
  | 'crc16_x25'
  | 'crc16_x25_no_header';

/**
 * Value encoding/decoding strategies for numeric states.
 */
export type DecodeEncodeType =
  | 'none'
  | 'bcd' // Binary Coded Decimal
  | 'ascii' // ASCII string to number
  | 'signed_byte_half_degree' // Signed byte where 1 unit = 0.5 degrees
  | 'multiply' // Multiply the value
  | 'add_0x80'; // Add 0x80 to value

export type EndianType = 'big' | 'little';

/**
 * Default packet structure and timing configuration.
 * Can be defined globally or overridden per entity.
 */
export interface PacketDefaults {
  rx_header?: number[];
  rx_footer?: number[];
  rx_checksum?: ChecksumType | string;
  rx_checksum2?: Checksum2Type | string;
  rx_length?: number;
  rx_min_length?: number;
  rx_max_length?: number;
  rx_length_expr?: string;
  rx_valid_headers?: number[];
  tx_header?: number[];
  tx_footer?: number[];
  tx_checksum?: ChecksumType | string;
  tx_checksum2?: Checksum2Type | string;
  tx_delay?: number;
  tx_retry_cnt?: number;
  tx_timeout?: number;
  rx_timeout?: number;
}

/**
 * Schema for matching and extracting state from a packet.
 */
export interface StateSchema {
  data?: number[];
  mask?: number | number[];
  index?: number;
  offset?: number;
  inverted?: boolean;
  guard?: string;
  except?: StateSchema[];
}

export interface StateNumSchema extends StateSchema {
  length?: number;
  precision?: number;
  signed?: boolean;
  endian?: EndianType;
  decode?: DecodeEncodeType;
  mapping?: { [key: number]: string | number };
}

export interface ProtocolConfig {
  packet_defaults?: PacketDefaults;
  rx_priority?: 'data' | 'loop';
}

export interface DeviceConfig {
  id: string;
  name: string;
  state?: StateSchema;
  optimistic?: boolean;
  restore_mode?: RestoreMode;
  state_proxy?: boolean;
  target_id?: string;
}

export interface CommandResult {
  packet: number[];
  ack?: StateSchema;
}

export type StateSchemaOrCEL = StateSchema | string;
export type StateNumSchemaOrCEL = StateNumSchema | string;
