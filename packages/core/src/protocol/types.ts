export type ChecksumType =
  | 'add'
  | 'xor'
  | 'add_no_header'
  | 'xor_no_header'
  | 'samsung_rx'
  | 'samsung_tx'
  | 'none';

export type Checksum2Type = 'xor_add';
export type DecodeEncodeType =
  | 'none'
  | 'bcd'
  | 'ascii'
  | 'signed_byte_half_degree'
  | 'multiply'
  | 'add_0x80';
export type EndianType = 'big' | 'little';

export interface PacketDefaults {
  rx_header?: number[];
  rx_footer?: number[];
  rx_checksum?: ChecksumType | string;
  rx_checksum2?: Checksum2Type | string;
  rx_length?: number;
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

export interface StateSchema {
  data?: number[];
  mask?: number | number[];
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
}

/**
 * Result of constructing a command packet.
 * Can include optional ACK matching information when using CEL expressions.
 */
export interface CommandResult {
  packet: number[];
  ack?: StateSchema;
}
