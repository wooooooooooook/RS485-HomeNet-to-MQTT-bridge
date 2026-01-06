export type ChecksumType =
  | 'add'
  | 'add_no_header'
  | 'xor'
  | 'xor_no_header'
  | 'samsung_rx'
  | 'samsung_tx'
  | 'bestin_sum'
  | 'none';

export type Checksum2Type = 'xor_add';

export type ByteArray = number[] | Buffer | Uint8Array;

/**
 * Calculate 1-byte checksum
 * @param header Header bytes
 * @param data Data bytes (excluding header and checksum)
 * @param type Checksum type
 * @returns Single byte checksum value
 */
export function calculateChecksum(header: ByteArray, data: ByteArray, type: ChecksumType): number {
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
    case 'bestin_sum':
      return bestinSum(header, data);
    case 'none':
      throw new Error("Checksum type 'none' should not be calculated");
    default:
      throw new Error(`Unknown checksum type: ${type}`);
  }
}

/**
 * Calculate 1-byte checksum from a single buffer without slicing
 * @param buffer Full packet buffer
 * @param type Checksum type
 * @param headerLength Length of the header
 * @param dataEnd Index where data ends (exclusive, typically checks starts here)
 */
export function calculateChecksumFromBuffer(
  buffer: ByteArray,
  type: ChecksumType,
  headerLength: number,
  dataEnd: number,
  baseOffset: number = 0,
): number {
  const dataStart = baseOffset;
  const headerStart = baseOffset + headerLength;
  const dataStop = baseOffset + dataEnd;
  switch (type) {
    case 'add':
      return addRange(buffer, dataStart, dataStop);
    case 'add_no_header':
      return addRange(buffer, headerStart, dataStop);
    case 'xor':
      return xorRange(buffer, dataStart, dataStop);
    case 'xor_no_header':
      return xorRange(buffer, headerStart, dataStop);
    case 'samsung_rx':
      return samsungRxFromBuffer(buffer, headerStart, dataStop);
    case 'samsung_tx':
      return samsungTxFromBuffer(buffer, headerStart, dataStop);
    case 'bestin_sum':
      return bestinSumFromBuffer(buffer, dataStart, dataStop);
    case 'none':
      throw new Error("Checksum type 'none' should not be calculated");
    default:
      throw new Error(`Unknown checksum type: ${type}`);
  }
}

function add(header: ByteArray, data: ByteArray): number {
  let sum = 0;
  for (const byte of header) {
    sum += byte;
  }
  for (const byte of data) {
    sum += byte;
  }
  return sum & 0xff;
}

function addNoHeader(data: ByteArray): number {
  let sum = 0;
  for (const byte of data) {
    sum += byte;
  }
  return sum & 0xff;
}

function addRange(buffer: ByteArray, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += buffer[i];
  }
  return sum & 0xff;
}

function xor(header: ByteArray, data: ByteArray): number {
  let checksum = 0;
  for (const byte of header) {
    checksum ^= byte;
  }
  for (const byte of data) {
    checksum ^= byte;
  }
  return checksum;
}

function xorNoHeader(data: ByteArray): number {
  let checksum = 0;
  for (const byte of data) {
    checksum ^= byte;
  }
  return checksum;
}

function xorRange(buffer: ByteArray, start: number, end: number): number {
  let checksum = 0;
  for (let i = start; i < end; i++) {
    checksum ^= buffer[i];
  }
  return checksum;
}

function samsungRx(data: ByteArray): number {
  let crc = 0xb0;
  for (const byte of data) {
    crc ^= byte;
  }
  if (data[0] < 0x7c) {
    crc ^= 0x80;
  }
  return crc;
}

function samsungRxFromBuffer(buffer: ByteArray, start: number, end: number): number {
  let crc = 0xb0;
  for (let i = start; i < end; i++) {
    crc ^= buffer[i];
  }
  if (start < end && buffer[start] < 0x7c) {
    crc ^= 0x80;
  }
  return crc;
}

function samsungTx(data: ByteArray): number {
  let crc = 0x00;
  for (const byte of data) {
    crc ^= byte;
  }
  crc ^= 0x80;
  return crc;
}

function samsungTxFromBuffer(buffer: ByteArray, start: number, end: number): number {
  let crc = 0x00;
  for (let i = start; i < end; i++) {
    crc ^= buffer[i];
  }
  crc ^= 0x80;
  return crc;
}

function bestinSum(header: ByteArray, data: ByteArray): number {
  let sum = 3;
  for (const byte of header) {
    sum = ((byte ^ sum) + 1) & 0xff;
  }
  for (const byte of data) {
    sum = ((byte ^ sum) + 1) & 0xff;
  }
  return sum;
}

function bestinSumFromBuffer(buffer: ByteArray, start: number, end: number): number {
  let sum = 3;
  for (let i = start; i < end; i++) {
    sum = ((buffer[i] ^ sum) + 1) & 0xff;
  }
  return sum;
}

/**
 * Calculate 2-byte checksum
 * @param header Header bytes
 * @param data Data bytes (excluding header and checksum)
 * @param type Checksum type
 * @returns Array of 2 bytes [high, low]
 */
export function calculateChecksum2(
  header: ByteArray,
  data: ByteArray,
  type: Checksum2Type,
): number[] {
  switch (type) {
    case 'xor_add':
      return xorAdd(header, data);
    default:
      throw new Error(`Unknown 2-byte checksum type: ${type}`);
  }
}

/**
 * Calculate 2-byte checksum from buffer without slicing
 */
export function calculateChecksum2FromBuffer(
  buffer: ByteArray,
  type: Checksum2Type,
  headerLength: number,
  dataEnd: number,
  baseOffset: number = 0,
): number[] {
  const dataStart = baseOffset;
  const dataStop = baseOffset + dataEnd;
  switch (type) {
    case 'xor_add':
      // xorAdd processes header then data linearly, so we can process range 0..dataEnd
      return xorAddRange(buffer, dataStart, dataStop);
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
function xorAdd(header: ByteArray, data: ByteArray): number[] {
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

function xorAddRange(buffer: ByteArray, start: number, end: number): number[] {
  let crc = 0;
  let temp = 0;

  for (let i = start; i < end; i++) {
    const byte = buffer[i];
    crc += byte;
    temp ^= byte;
  }

  crc += temp;

  // Pack into 2 bytes: [XOR, ADD]
  const high = temp & 0xff;
  const low = crc & 0xff;

  return [high, low];
}
