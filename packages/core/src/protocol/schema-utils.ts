import { Buffer } from 'buffer';
import { StateSchema, StateNumSchema } from './types.js';

export const extractFromSchema = (packet: Buffer, schema: StateSchema | StateNumSchema): any => {
  const { offset = 0, data, mask, inverted = false } = schema;
  const numSchema = schema as StateNumSchema;

  // Determine length
  let length = 1;
  if (typeof numSchema.length === 'number') {
    length = numSchema.length;
  } else if (data) {
    length = data.length;
  }

  // Safety check
  if (offset + length > packet.length) {
    return null;
  }

  // 1. Check Data Match (if data is provided)
  if (data) {
    for (let i = 0; i < data.length; i++) {
      const pByte = packet[offset + i];
      const dByte = data[i];
      let mByte = 0xff;

      if (mask) {
        if (Array.isArray(mask)) {
          mByte = mask[i] ?? 0xff;
        } else {
          mByte = mask;
        }
      }

      if ((pByte & mByte) !== (dByte & mByte)) {
        return null; // Mismatch
      }
    }
  }

  // 2. Extract Value (Optimized to avoid array allocation)
  const decode = numSchema.decode || 'none';
  const endian = numSchema.endian || 'big';
  const signed = numSchema.signed || false;
  const precision = numSchema.precision || 0;

  // Handle ASCII separately (string creation)
  if (decode === 'ascii') {
    const extractedBytes: number[] = [];
    for (let i = 0; i < length; i++) {
      let val = packet[offset + i];
      if (mask || inverted) {
        let mByte = 0xff;
        if (mask) {
          if (Array.isArray(mask)) {
            mByte = mask[i] ?? 0xff;
          } else {
            mByte = mask;
          }
        }
        if (inverted) {
          val = ~val;
        }
        val = val & mByte;
      }
      extractedBytes.push(val);
    }
    if (endian === 'little') {
      extractedBytes.reverse();
    }
    return String.fromCharCode(...extractedBytes);
  }

  let value = 0;

  if (decode === 'signed_byte_half_degree') {
    // Only considers the MSB of the extraction window
    // Big Endian: byte at offset
    // Little Endian: byte at offset + length - 1
    const idx = endian === 'little' ? length - 1 : 0;
    let val = packet[offset + idx];

    if (mask || inverted) {
      let mByte = 0xff;
      if (mask) {
        if (Array.isArray(mask)) {
          mByte = mask[idx] ?? 0xff;
        } else {
          mByte = mask;
        }
      }
      if (inverted) {
        val = ~val;
      }
      val = val & mByte;
    }

    let res = val & 0x7f;
    if ((val & 0x80) !== 0) {
      res += 0.5;
    }
    if (signed && (val & 0x40) !== 0) {
      res = -res;
    }
    value = res;
  } else {
    // Numeric types: 'none' (integer) or 'bcd'
    // Big Endian: iterate 0 to length-1 (MSB first)
    // Little Endian: iterate length-1 to 0 (MSB is at the end of the packet segment)
    const start = endian === 'little' ? length - 1 : 0;
    const end = endian === 'little' ? -1 : length;
    const step = endian === 'little' ? -1 : 1;

    for (let i = start; i !== end; i += step) {
      let val = packet[offset + i];

      if (mask || inverted) {
        let mByte = 0xff;
        if (mask) {
          if (Array.isArray(mask)) {
            mByte = mask[i] ?? 0xff;
          } else {
            mByte = mask;
          }
        }
        if (inverted) {
          val = ~val;
        }
        val = val & mByte;
      }

      if (decode === 'bcd') {
        value = value * 100 + (val >> 4) * 10 + (val & 0x0f);
      } else {
        value = value * 256 + val;
      }
    }
  }

  // Signed integer handling (Two's complement)
  if (decode === 'none' && signed) {
    const bitLen = length * 8;
    const maxUnsigned = Math.pow(2, bitLen);
    if (value >= maxUnsigned / 2) {
      value = value - maxUnsigned;
    }
  }

  // Precision
  if (precision > 0) {
    value = parseFloat((value / Math.pow(10, precision)).toFixed(precision));
  }

  // Mapping
  if (numSchema.mapping) {
    if (value in numSchema.mapping) {
      return numSchema.mapping[value];
    }
  }

  return value;
};
