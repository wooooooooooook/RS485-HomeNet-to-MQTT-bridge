export type ChecksumType =
  | 'add'
  | 'add_no_header'
  | 'xor'
  | 'xor_no_header'
  | 'xor_add'
  | 'samsung_rx'
  | 'samsung_tx'
  | 'none';

export function calculateChecksum(data: Buffer, type: ChecksumType): number {
  switch (type) {
    case 'add':
      return add(data);
    case 'add_no_header':
      return addNoHeader(data);
    case 'xor':
      return xor(data);
    case 'xor_no_header':
      return xorNoHeader(data);
    case 'xor_add':
      // This is a guess based on the name.
      // It might need to be adjusted based on device behavior.
      return xor(data);
    case 'samsung_rx':
      return samsungRx(data);
    case 'samsung_tx':
      return samsungTx(data);
    case 'none':
      return 0; // No checksum
    default:
      throw new Error(`Unknown checksum type: ${type}`);
  }
}

function add(data: Buffer): number {
  let sum = 0;
  for (const byte of data) {
    sum += byte;
  }
  return sum & 0xff;
}

function addNoHeader(data: Buffer): number {
  let sum = 0;
  for (let i = 1; i < data.length; i++) {
    sum += data[i];
  }
  return sum & 0xff;
}

function xor(data: Buffer): number {
  let checksum = 0;
  for (const byte of data) {
    checksum ^= byte;
  }
  return checksum;
}

function xorNoHeader(data: Buffer): number {
  let checksum = 0;
  for (let i = 1; i < data.length; i++) {
    checksum ^= data[i];
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
