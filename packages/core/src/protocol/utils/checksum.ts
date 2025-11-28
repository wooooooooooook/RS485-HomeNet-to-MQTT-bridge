export type ChecksumType =
  | 'add'
  | 'add_no_header'
  | 'xor'
  | 'xor_no_header'
  | 'samsung_rx'
  | 'samsung_tx'
  | 'none';

export type Checksum2Type = 'xor_add';

/**
 * Calculate 1-byte checksum
 * @param header Header bytes
 * @param data Data bytes (excluding header and checksum)
 * @param type Checksum type
 * @returns Single byte checksum value
 */
export function calculateChecksum(header: Buffer, data: Buffer, type: ChecksumType): number {
  switch (type) {
    case 'add':
      return add(header, data);
    case 'add_no_header':
      return addNoHeader(data);
    case 'xor':
      return xor(header, data);
    case 'xor_no_header':
      return xorNoHeader(data);
    case 'samsung_rx':
      return samsungRx(data);
    case 'samsung_tx':
      return samsungTx(data);
    case 'none':
      throw new Error("Checksum type 'none' should not be calculated");
    default:
      throw new Error(`Unknown checksum type: ${type}`);
  }
}

function add(header: Buffer, data: Buffer): number {
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  for (const byte of data) {
    sum += byte;
  }
  return sum & 0xff;
}

function addNoHeader(data: Buffer): number {
  let sum = 0;
  for (const byte of data) {
    sum += byte;
  }
  return sum & 0xff;
}

function xor(header: Buffer, data: Buffer): number {
  let checksum = 0;
  for (const byte of header) {
    checksum ^= byte;
  }
  for (const byte of data) {
    checksum ^= byte;
  }
  return checksum;
}

function xorNoHeader(data: Buffer): number {
  let checksum = 0;
  for (const byte of data) {
    checksum ^= byte;
  }
  return checksum;
}

function samsungRx(data: Buffer): number {
  let crc = 0xb0;
  for (const byte of data) {
    crc ^= byte;
  }
  if (data[0] < 0x7c) {
    crc ^= 0x80;
  }
  return crc;
}

function samsungTx(data: Buffer): number {
  let crc = 0x00;
  for (const byte of data) {
    crc ^= byte;
  }
  crc ^= 0x80;
  return crc;
}

/**
 * Calculate 2-byte checksum
 * @param header Header bytes
 * @param data Data bytes (excluding header and checksum)
 * @param type Checksum type
 * @returns Array of 2 bytes [high, low]
 */
export function calculateChecksum2(header: Buffer, data: Buffer, type: Checksum2Type): number[] {
  switch (type) {
    case 'xor_add':
      return xorAdd(header, data);
    default:
      throw new Error(`Unknown 2-byte checksum type: ${type}`);
  }
}

/**
 * XOR_ADD 2-byte checksum
 * Based on user-provided algorithm:
 * - Accumulates ADD and XOR separately for header and data
 * - Adds XOR result to ADD accumulator
 * - Packs as [XOR, ADD&0xFF]
 */
function xorAdd(header: Buffer, data: Buffer): number[] {
  let crc = 0;
  let temp = 0;

  // Process header bytes
  for (const byte of header) {
    crc += byte;
    temp ^= byte;
  }

  // Process data bytes
  for (const byte of data) {
    crc += byte;
    temp ^= byte;
  }

  crc += temp;

  // Pack into 2 bytes: [XOR, ADD]
  const high = temp & 0xff;
  const low = crc & 0xff;

  return [high, low];
}
