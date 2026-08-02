// packages/core/src/transports/matter/utils/trim-to-length.ts

/**
 * Trims a string to the specified maximum byte length when encoded as UTF-8.
 * This is useful for Matter constraints which strictly limit byte lengths.
 */
export function trimToLength(
  value: string | undefined | null,
  maxLengthBytes: number,
): string | undefined {
  if (value == null) {
    return undefined;
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);

  if (bytes.length <= maxLengthBytes) {
    return value;
  }

  // Truncate bytes to the maximum length
  const truncatedBytes = bytes.slice(0, maxLengthBytes);

  const decoder = new TextDecoder('utf-8', { fatal: false });
  let result = decoder.decode(truncatedBytes);

  // If the last character was a multi-byte character that got split,
  // the non-fatal decoder will insert replacement characters (\uFFFD).
  // We should remove them if they occur at the very end.
  while (result.endsWith('\uFFFD')) {
    result = result.slice(0, -1);
  }

  return result;
}
