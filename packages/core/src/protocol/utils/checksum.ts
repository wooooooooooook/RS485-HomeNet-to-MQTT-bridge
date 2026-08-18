import type { ChecksumType, Checksum2Type } from '../types.js';
import { Buffer } from 'buffer';

export type { ChecksumType, Checksum2Type };

const XOR_FINAL_TYPES = Array.from({ length: 256 }, (_, value) =>
  `xor_final(0x${value.toString(16).padStart(2, '0')})`,
) as ChecksumType[];

export const STANDARD_CHECKSUM_TYPES = [
  'add',
  'add_no_header',
  'xor',
  'xor_no_header',
  'samsung_rx',
  'samsung_tx',
  'samsung_xor',
  'bestin_sum',
  'crc8',
  'crc8_no_header',
  'crc8_maxim',
  'crc8_maxim_no_header',
  'crc8_rohc',
  'crc8_rohc_no_header',
  'crc8_wcdma',
  'crc8_wcdma_no_header',
  'none',
  ...XOR_FINAL_TYPES,
] as readonly ChecksumType[];

export const STANDARD_CHECKSUM2_TYPES = [
  'xor_add',
  'crc_ccitt_xmodem',
  'crc16_xmodem',
  'crc16_xmodem_no_header',
  'crc16_ccitt_false',
  'crc16_ccitt_false_no_header',
  'crc16_modbus',
  'crc16_modbus_no_header',
  'crc16_ibm',
  'crc16_ibm_no_header',
  'crc16_kermit',
  'crc16_kermit_no_header',
  'crc16_x25',
  'crc16_x25_no_header',
] as const satisfies readonly Checksum2Type[];

type Crc16Variant =
  | 'crc16_xmodem'
  | 'crc16_ccitt_false'
  | 'crc16_modbus'
  | 'crc16_ibm'
  | 'crc16_kermit'
  | 'crc16_x25';
type Crc8Variant = 'crc8' | 'crc8_maxim' | 'crc8_rohc' | 'crc8_wcdma';
type CrcSpec = { poly: number; init: number; refin: boolean; refout: boolean; xorOut: number };

const CRC8_SPECS: Record<Crc8Variant, CrcSpec> = {
  crc8: { poly: 0x07, init: 0, refin: false, refout: false, xorOut: 0 },
  crc8_maxim: { poly: 0x31, init: 0, refin: true, refout: true, xorOut: 0 },
  crc8_rohc: { poly: 0x07, init: 0xff, refin: true, refout: true, xorOut: 0 },
  crc8_wcdma: { poly: 0x9b, init: 0, refin: true, refout: true, xorOut: 0 },
};
const CRC16_SPECS: Record<Crc16Variant, CrcSpec> = {
  crc16_xmodem: { poly: 0x1021, init: 0, refin: false, refout: false, xorOut: 0 },
  crc16_ccitt_false: { poly: 0x1021, init: 0xffff, refin: false, refout: false, xorOut: 0 },
  crc16_modbus: { poly: 0x8005, init: 0xffff, refin: true, refout: true, xorOut: 0 },
  crc16_ibm: { poly: 0x8005, init: 0, refin: true, refout: true, xorOut: 0 },
  crc16_kermit: { poly: 0x1021, init: 0, refin: true, refout: true, xorOut: 0 },
  crc16_x25: { poly: 0x1021, init: 0xffff, refin: true, refout: true, xorOut: 0xffff },
};

export type ByteArray = number[] | Buffer | Uint8Array;
export type Checksum2Verifier = (
  buffer: ByteArray,
  start: number,
  end: number,
  expectedHigh: number,
  expectedLow: number,
) => boolean;

type XorFinal = { offset: number; finalXor: number };
function parseXorFinal(type: string): XorFinal | null {
  const match = /^xor_final\(0x([0-9a-fA-F]{2})\)$/.exec(type);
  return match ? { offset: 0, finalXor: Number.parseInt(match[1], 16) } : null;
}

function xorRange(buffer: ByteArray, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end; i++) value ^= buffer[i];
  return value;
}

function xorFinalRange(buffer: ByteArray, start: number, end: number, finalXor: number): number {
  return xorRange(buffer, start, end) ^ finalXor;
}

function addRange(buffer: ByteArray, start: number, end: number): number {
  let value = 0;
  for (let i = start; i < end; i++) value += buffer[i];
  return value & 0xff;
}

function samsungRxRange(buffer: ByteArray, start: number, end: number): number {
  let crc = 0xb0;
  for (let i = start; i < end; i++) crc ^= buffer[i];
  if (start < end && buffer[start] < 0x7c) crc ^= 0x80;
  return crc;
}
function samsungTxRange(buffer: ByteArray, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) crc ^= buffer[i];
  return crc ^ 0x80;
}
function samsungXorRange(buffer: ByteArray, start: number, end: number): number {
  return xorRange(buffer, start, end) & 0x7f;
}
function bestinRange(buffer: ByteArray, start: number, end: number): number {
  let sum = 3;
  for (let i = start; i < end; i++) sum = ((buffer[i] ^ sum) + 1) & 0xff;
  return sum;
}

function reflect(value: number, bits: number): number {
  let result = 0;
  for (let i = 0; i < bits; i++) if (value & (1 << i)) result |= 1 << (bits - 1 - i);
  return result;
}

function crc8Table(spec: CrcSpec): Uint8Array {
  const table = new Uint8Array(256);
  const poly = spec.refin ? reflect(spec.poly, 8) : spec.poly;
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = spec.refin
        ? crc & 1 ? ((crc >>> 1) ^ poly) & 0xff : crc >>> 1
        : crc & 0x80 ? ((crc << 1) ^ poly) & 0xff : (crc << 1) & 0xff;
    }
    table[i] = crc;
  }
  return table;
}
function crc8Range(buffer: ByteArray, start: number, end: number, spec: CrcSpec): number {
  const table = crc8Table(spec);
  let crc = spec.init & 0xff;
  for (let i = start; i < end; i++) crc = table[(crc ^ buffer[i]) & 0xff];
  if (spec.refout !== spec.refin) crc = reflect(crc, 8);
  return (crc ^ spec.xorOut) & 0xff;
}

function crc16Table(spec: CrcSpec): Uint16Array {
  const table = new Uint16Array(256);
  const poly = spec.refin ? reflect(spec.poly, 16) : spec.poly;
  for (let i = 0; i < 256; i++) {
    let crc = spec.refin ? i : i << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = spec.refin
        ? crc & 1 ? ((crc >>> 1) ^ poly) & 0xffff : crc >>> 1
        : crc & 0x8000 ? ((crc << 1) ^ poly) & 0xffff : (crc << 1) & 0xffff;
    }
    table[i] = crc;
  }
  return table;
}
function crc16Range(buffer: ByteArray, start: number, end: number, spec: CrcSpec): number[] {
  const table = crc16Table(spec);
  let crc = spec.init & 0xffff;
  if (spec.refin) {
    for (let i = start; i < end; i++) crc = (table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)) & 0xffff;
  } else {
    for (let i = start; i < end; i++) crc = (table[((crc >>> 8) ^ buffer[i]) & 0xff] ^ (crc << 8)) & 0xffff;
  }
  if (spec.refout !== spec.refin) crc = reflect(crc, 16);
  crc = (crc ^ spec.xorOut) & 0xffff;
  return [(crc >>> 8) & 0xff, crc & 0xff];
}

function crc8Variant(type: string): { base: Crc8Variant; includeHeader: boolean } | null {
  const noHeader = type.endsWith('_no_header');
  const base = (noHeader ? type.slice(0, -10) : type) as Crc8Variant;
  return base in CRC8_SPECS ? { base, includeHeader: !noHeader } : null;
}
function crc16Variant(type: Checksum2Type): { base: Crc16Variant; includeHeader: boolean } | null {
  if (type === 'crc_ccitt_xmodem') return { base: 'crc16_xmodem', includeHeader: false };
  const noHeader = type.endsWith('_no_header');
  const base = (noHeader ? type.slice(0, -10) : type) as Crc16Variant;
  return base in CRC16_SPECS ? { base, includeHeader: !noHeader } : null;
}

export function calculateChecksum(header: ByteArray, data: ByteArray, type: ChecksumType): number {
  const dynamic = parseXorFinal(type);
  if (dynamic) return xorFinalRange([...header, ...data], 0, header.length + data.length, dynamic.finalXor);
  const crc = crc8Variant(type);
  if (crc) return crc8Range(crc.includeHeader ? [...header, ...data] : data, 0, crc.includeHeader ? header.length + data.length : data.length, CRC8_SPECS[crc.base]);
  switch (type) {
    case 'add': return addRange([...header, ...data], 0, header.length + data.length);
    case 'add_no_header': return addRange(data, 0, data.length);
    case 'xor': return xorRange([...header, ...data], 0, header.length + data.length);
    case 'xor_no_header': return xorRange(data, 0, data.length);
    case 'samsung_rx': return samsungRxRange(data, 0, data.length);
    case 'samsung_tx': return samsungTxRange(data, 0, data.length);
    case 'samsung_xor': return samsungXorRange([...header, ...data], 0, header.length + data.length);
    case 'bestin_sum': return bestinRange([...header, ...data], 0, header.length + data.length);
    case 'none': throw new Error("Checksum type 'none' should not be calculated");
    default: throw new Error(`Unknown checksum type: ${type}`);
  }
}

export function calculateChecksumFromBuffer(
  buffer: ByteArray,
  type: ChecksumType,
  headerLength: number,
  dataEnd: number,
  baseOffset = 0,
): number {
  const start = baseOffset;
  const headerStart = baseOffset + headerLength;
  const end = baseOffset + dataEnd;
  const dynamic = parseXorFinal(type);
  if (dynamic) return xorFinalRange(buffer, start, end, dynamic.finalXor);
  const crc = crc8Variant(type);
  if (crc) return crc8Range(buffer, crc.includeHeader ? start : headerStart, end, CRC8_SPECS[crc.base]);
  switch (type) {
    case 'add': return addRange(buffer, start, end);
    case 'add_no_header': return addRange(buffer, headerStart, end);
    case 'xor': return xorRange(buffer, start, end);
    case 'xor_no_header': return xorRange(buffer, headerStart, end);
    case 'samsung_rx': return samsungRxRange(buffer, headerStart, end);
    case 'samsung_tx': return samsungTxRange(buffer, headerStart, end);
    case 'samsung_xor': return samsungXorRange(buffer, start, end);
    case 'bestin_sum': return bestinRange(buffer, start, end);
    case 'none': throw new Error("Checksum type 'none' should not be calculated");
    default: throw new Error(`Unknown checksum type: ${type}`);
  }
}

export function calculateChecksum2(header: ByteArray, data: ByteArray, type: Checksum2Type): number[] {
  const combined = [...header, ...data];
  const variant = crc16Variant(type);
  if (variant) return crc16Range(variant.includeHeader ? combined : data, 0, variant.includeHeader ? combined.length : data.length, CRC16_SPECS[variant.base]);
  if (type === 'xor_add') return xorAddRange(combined, 0, combined.length);
  throw new Error(`Unknown 2-byte checksum type: ${type}`);
}

export function calculateChecksum2FromBuffer(
  buffer: ByteArray,
  type: Checksum2Type,
  headerLength: number,
  dataEnd: number,
  baseOffset = 0,
): number[] {
  const start = baseOffset;
  const headerStart = baseOffset + headerLength;
  const end = baseOffset + dataEnd;
  const variant = crc16Variant(type);
  if (variant) return crc16Range(buffer, variant.includeHeader ? start : headerStart, end, CRC16_SPECS[variant.base]);
  if (type === 'xor_add') return xorAddRange(buffer, start, end);
  throw new Error(`Unknown 2-byte checksum type: ${type}`);
}

export function verifyChecksum2FromBuffer(
  buffer: ByteArray,
  type: Checksum2Type,
  headerLength: number,
  dataEnd: number,
  baseOffset = 0,
  expectedHigh: number,
  expectedLow: number,
): boolean {
  const [high, low] = calculateChecksum2FromBuffer(buffer, type, headerLength, dataEnd, baseOffset);
  return high === expectedHigh && low === expectedLow;
}

function xorAddRange(buffer: ByteArray, start: number, end: number): number[] {
  let sum = 0;
  let xor = 0;
  for (let i = start; i < end; i++) { sum += buffer[i]; xor ^= buffer[i]; }
  return [xor & 0xff, (sum + xor) & 0xff];
}
export function verifyXorAddRange(buffer: ByteArray, start: number, end: number, expectedHigh: number, expectedLow: number): boolean {
  const [high, low] = xorAddRange(buffer, start, end);
  return high === expectedHigh && low === expectedLow;
}

export function getChecksumFunction(type: ChecksumType): ((buffer: ByteArray, start: number, end: number) => number) | null {
  const dynamic = parseXorFinal(type);
  if (dynamic) return (buffer, start, end) => xorFinalRange(buffer, start, end, dynamic.finalXor);
  const crc = crc8Variant(type);
  if (crc) return (buffer, start, end) => crc8Range(buffer, start, end, CRC8_SPECS[crc.base]);
  switch (type) {
    case 'add': case 'add_no_header': return addRange;
    case 'xor': case 'xor_no_header': return xorRange;
    case 'samsung_rx': return samsungRxRange;
    case 'samsung_tx': return samsungTxRange;
    case 'samsung_xor': return samsungXorRange;
    case 'bestin_sum': return bestinRange;
    default: return null;
  }
}

export function getChecksum2Verifier(type: Checksum2Type): Checksum2Verifier | null {
  const variant = crc16Variant(type);
  if (variant) return (buffer, start, end, expectedHigh, expectedLow) => {
    const [high, low] = crc16Range(buffer, start, end, CRC16_SPECS[variant.base]);
    return high === expectedHigh && low === expectedLow;
  };
  return type === 'xor_add' ? verifyXorAddRange : null;
}

export function getChecksumOffsetType(type: ChecksumType): 'base' | 'header' {
  if (type.endsWith('_no_header') || type === 'samsung_rx' || type === 'samsung_tx') return 'header';
  return 'base';
}
export function getChecksum2OffsetType(type: Checksum2Type): 'base' | 'header' {
  const variant = crc16Variant(type);
  return variant?.includeHeader === false ? 'header' : 'base';
}

export function crc8RangeCustom(buffer: ByteArray, start: number, end: number, poly: number, init: number, refin: boolean, refout: boolean, xorOut: number): number {
  return crc8Range(buffer, start, end, { poly, init, refin, refout, xorOut });
}
export function crc16RangeCustom(buffer: ByteArray, start: number, end: number, poly: number, init: number, refin: boolean, refout: boolean, xorOut: number): number[] {
  return crc16Range(buffer, start, end, { poly, init, refin, refout, xorOut });
}
