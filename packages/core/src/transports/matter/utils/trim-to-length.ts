// packages/core/src/transports/matter/utils/trim-to-length.ts

/**
 * Trims a string to the specified maximum byte length when encoded as UTF-8.
 * This is useful for Matter constraints which strictly limit byte lengths.
 */
export function trimToLength(str: string, maxLengthBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);

  if (bytes.length <= maxLengthBytes) {
    return str;
  }

  // Truncate bytes to the maximum length
  const truncatedBytes = bytes.slice(0, maxLengthBytes);

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let result = decoder.decode(truncatedBytes);

  // If the last character was a multi-byte character that got split,
  // the non-fatal decoder will insert a replacement character ().
  // We should remove it if it occurs at the very end.
  if (result.endsWith('\uFFFD')) {
    result = result.slice(0, -1);
  }

  return result;
}
