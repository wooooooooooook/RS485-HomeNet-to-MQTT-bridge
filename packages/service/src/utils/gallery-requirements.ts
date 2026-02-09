import { HomenetBridgeConfig } from '@rs485-homenet/core';

// Helper for flexible matching
export const matchRequirement = (expected: unknown, actual: unknown): boolean => {
  // Normalize values: treat empty arrays, null, and undefined as equivalent (empty/default)
  const normalizeValue = (v: unknown): string | unknown => {
    if (v === null || v === undefined) return '__EMPTY__';
    if (Array.isArray(v) && v.length === 0) return '__EMPTY__';
    if (Array.isArray(v)) return JSON.stringify(v);
    return v;
  };

  // 1. List matching (Array)
  if (Array.isArray(expected)) {
    // Try exact match first (e.g. expected is [0xaa] and actual is [0xaa])
    if (normalizeValue(expected) === normalizeValue(actual)) {
      return true;
    }

    // Then try list match (e.g. expected is [[0xaa], [0xbb]] and actual is [0xaa])
    return expected.some((expItem) => normalizeValue(expItem) === normalizeValue(actual));
  }

  // 2. Range matching (Object with min/max)
  if (
    typeof expected === 'object' &&
    expected !== null &&
    ('min' in expected || 'max' in expected)
  ) {
    const range = expected as { min?: number; max?: number };
    if (typeof actual !== 'number') return false;

    if (range.min !== undefined && actual < range.min) return false;
    if (range.max !== undefined && actual > range.max) return false;
    return true;
  }

  // 3. Exact matching (Primitive or simple object)
  return normalizeValue(expected) === normalizeValue(actual);
};

// Helper to check if a config matches vendor requirements
export function checkConfigRequirements(
  config: HomenetBridgeConfig,
  requirements: { serial?: Record<string, unknown>; packet_defaults?: Record<string, unknown> },
): boolean {
  if (!config.serial) return false;

  // Check serial settings
  if (requirements.serial) {
    const serialFields = ['baud_rate', 'data_bits', 'parity', 'stop_bits'];
    for (const field of serialFields) {
      const expected = requirements.serial[field];
      const actual = config.serial[field as keyof typeof config.serial];

      // Skip check if requirement is not defined
      if (expected === undefined) continue;

      // actual can be undefined in config, need to handle it.
      // If expected is defined but actual is undefined, it's a mismatch (unless expected allows undefined/null, but usually config MUST exist)
      if (actual === undefined && expected !== undefined) return false;

      if (!matchRequirement(expected, actual)) {
        return false;
      }
    }
  }

  // Check packet_defaults
  if (requirements.packet_defaults) {
    const packetDefaults = config.packet_defaults || {};
    const packetFields = [
      'rx_length',
      'rx_checksum',
      'tx_checksum',
      'rx_header',
      'tx_header',
      'rx_footer',
      'tx_footer',
    ];

    for (const field of packetFields) {
      const expected = requirements.packet_defaults[field];
      const actual = packetDefaults[field as keyof typeof packetDefaults];

      if (expected !== undefined) {
         if (!matchRequirement(expected, actual)) {
          return false;
        }
      }
    }
  }

  return true;
}
