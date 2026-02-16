// packages/core/src/protocol/utils/common.ts

// Utility to convert hex string to byte array
export function hexToBytes(hex: string): number[] {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

// Utility to convert byte array to hex string
export function bytesToHex(bytes: number[]): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
