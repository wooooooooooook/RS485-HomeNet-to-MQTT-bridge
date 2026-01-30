/**
 * Supported 1-byte checksum algorithms.
 *
 * - `add`: Sum of all bytes (header + data) & 0xFF.
 * - `add_no_header`: Sum of data bytes (excluding header) & 0xFF.
 * - `xor`: XOR of all bytes (header + data).
 * - `xor_no_header`: XOR of data bytes (excluding header).
 * - `samsung_rx`: (@deprecated) Specialized Samsung Wallpad RX checksum (0xB0 ^ XOR). If data[0] < 0x7C, result ^= 0x80.
 * - `samsung_tx`: (@deprecated) Specialized Samsung Wallpad TX checksum.
 * - `samsung_xor`: XOR of all bytes & 0x7F (Msb 0).
 * - `bestin_sum`: Cumulative XOR-based sum algorithm.
 * - `none`: No checksum calculation.
 */
export type ChecksumType =
  | 'add'
  | 'xor'
  | 'add_no_header'
  | 'xor_no_header'
  | 'samsung_rx'
  | 'samsung_tx'
  | 'samsung_xor'
  | 'bestin_sum'
  | 'none';

/**
 * Supported 2-byte checksum algorithms.
 *
 * - `xor_add`: Returns [XOR_SUM, (ADD_SUM + XOR_SUM) & 0xFF].
 */
export type Checksum2Type = 'xor_add';

/**
 * Value encoding/decoding strategies for numeric states.
 */
export type DecodeEncodeType =
  | 'none'
  | 'bcd' // Binary Coded Decimal
  | 'ascii' // ASCII string to number
  | 'signed_byte_half_degree' // Signed byte where 1 unit = 0.5 degrees
  | 'multiply' // Use mapping/factor logic
  | 'add_0x80'; // Add 0x80 to value

export type EndianType = 'big' | 'little';

/**
 * Default packet structure and timing configuration.
 * Can be defined globally or overridden per entity.
 */
export interface PacketDefaults {
  /**
   * Header bytes for received packets.
   * @example [0xAA, 0x55]
   */
  rx_header?: number[];

  /**
   * Footer bytes for received packets.
   * @example [0x0D, 0x0D]
   */
  rx_footer?: number[];

  /**
   * Checksum algorithm or CEL expression for received packets.
   * If CEL, `data` (List<int>) and `len` (int) variables are available.
   * @example 'add_no_header' or 'data[0] + data[1]'
   */
  rx_checksum?: ChecksumType | string;

  /**
   * Secondary checksum algorithm (2 bytes) or CEL expression.
   */
  rx_checksum2?: Checksum2Type | string;

  /**
   * Fixed length of the packet (including header/footer).
   * If set, parser will wait for this many bytes.
   */
  rx_length?: number;

  /**
   * Minimum packet length allowed (including header/footer).
   * Packets shorter than this length will be ignored.
   */
  rx_min_length?: number;

  /**
   * Maximum packet length allowed (including header/footer).
   * Packets longer than this length will be ignored.
   */
  rx_max_length?: number;

  /**
   * CEL expression to calculate dynamic packet length.
   * Returns the expected total length, or 0/negative to fallback to Checksum Sweep.
   * Available variables: `data` (current buffer), `len` (buffer length).
   */
  rx_length_expr?: string;

  /**
   * List of valid start bytes.
   * Even if checksum passes, packet is invalid if the first byte is not in this list.
   * Useful for avoiding false positives on noisy lines.
   */
  rx_valid_headers?: number[];

  /**
   * Header bytes for transmitted packets.
   */
  tx_header?: number[];

  /**
   * Footer bytes for transmitted packets.
   */
  tx_footer?: number[];

  /**
   * Checksum algorithm or CEL expression for transmitted packets.
   */
  tx_checksum?: ChecksumType | string;

  /**
   * Secondary checksum algorithm for transmitted packets.
   */
  tx_checksum2?: Checksum2Type | string;

  /**
   * Delay (in ms) before retrying a failed transmission.
   * @default 50
   */
  tx_delay?: number;

  /**
   * Number of times to retry transmission if no response is received.
   * @default 5
   */
  tx_retry_cnt?: number;

  /**
   * Maximum time (in ms) to wait for an ACK or response after transmission.
   * @default 100
   */
  tx_timeout?: number;

  /**
   * Maximum time (in ms) to wait for a status update packet.
   */
  rx_timeout?: number;
}

/**
 * Schema for matching and extracting state from a packet.
 */
export interface StateSchema {
  /**
   * Exact sequence of bytes to match.
   */
  data?: number[];

  /**
   * Bitmask to apply to the value byte(s).
   */
  mask?: number | number[];

  /**
   * Byte offset in the packet payload where the state value is located.
   */
  offset?: number;

  /**
   * If true, inverts the boolean logic or bits.
   */
  inverted?: boolean;

  /**
   * CEL expression condition that must be true for this state to match.
   */
  guard?: string;

  /**
   * List of schemas to explicitly exclude.
   */
  except?: StateSchema[];
}

/**
 * Extended schema for numeric values.
 */
export interface StateNumSchema extends StateSchema {
  /**
   * Number of bytes representing the value.
   */
  length?: number;

  /**
   * Number of decimal places.
   */
  precision?: number;

  /**
   * If true, treat as signed integer.
   */
  signed?: boolean;

  /**
   * Byte order (endianness).
   */
  endian?: EndianType;

  /**
   * specialized decoding strategy.
   */
  decode?: DecodeEncodeType;

  /**
   * Map of raw values to human-readable strings or numbers.
   */
  mapping?: { [key: number]: string | number };
}

// New Uartex-style types

export interface ProtocolConfig {
  packet_defaults?: PacketDefaults;
  rx_priority?: 'data' | 'loop';
}

export interface DeviceConfig {
  id: string;
  name: string;
  // Add other common device properties here
  state?: StateSchema;
  optimistic?: boolean;
  state_proxy?: boolean;
  target_id?: string;
}

/**
 * Result of constructing a command packet.
 * Can include optional ACK matching information when using CEL expressions.
 */
export interface CommandResult {
  packet: number[];
  ack?: StateSchema;
}

/**
 * State schema that can be either a structured schema object or a CEL expression string.
 * CEL expressions are evaluated at runtime to extract values from packet data.
 * @example { offset: 5, length: 2 } or 'data[5] * 256 + data[6]'
 */
export type StateSchemaOrCEL = StateSchema | string;

/**
 * Numeric state schema that can be either a structured schema object or a CEL expression string.
 * CEL expressions are evaluated at runtime to extract numeric values from packet data.
 * @example { offset: 5, length: 1, precision: 1 } or 'data[5] / 10.0'
 */
export type StateNumSchemaOrCEL = StateNumSchema | string;
