/**
 * Discovery Service - Evaluates discovery schemas against packet dictionary
 */

import { CelExecutor } from '@rs485-homenet/core';

// ============================================================================
// Types
// ============================================================================

export interface DiscoveryMatch {
  data?: number[];
  mask?: number[];
  offset?: number;
  any_of?: DiscoveryMatch[];
  regex?: string; // Regex on Hex String (e.g. "B0 41 .* 02")
  condition?: string; // CEL Expression (e.g. "data[2] == 0x30 && data[5] > 0x10")
}

export interface DiscoveryDimension {
  parameter: string;
  offset: number;
  mask?: number;
  transform?: string; // CEL Expression (x is the value)
  detect?: 'active_bits';
}

export interface DiscoveryInference {
  strategy: 'max' | 'count' | 'unique_tuples' | 'grouped';
  output?: string; // For unique_tuples/grouped, the output parameter name
}

export interface DiscoverySchema {
  match: DiscoveryMatch;
  dimensions: DiscoveryDimension[];
  inference?: DiscoveryInference;
}

export interface DiscoveryResult {
  matched: boolean;
  matchedPacketCount: number;
  parameterValues: Record<string, unknown>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse hex string to byte array
 * e.g., "B0 01 02" or "B00102" -> [0xB0, 0x01, 0x02]
 */
function hexToBytes(hex: string): number[] {
  const cleanHex = hex.replace(/\s+/g, '').toUpperCase();
  const bytes: number[] = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.slice(i, i + 2), 16));
  }
  return bytes;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

/**
 * Check if a single match condition applies to a packet
 */
function matchesCondition(
  packet: number[],
  match: DiscoveryMatch,
  defaultOffset?: number,
): boolean {
  // 1. Regex Match (on Hex String)
  if (match.regex) {
    const hexString = bytesToHex(packet);
    try {
      const regex = new RegExp(match.regex);
      if (!regex.test(hexString)) {
        return false;
      }
    } catch (e) {
      // Invalid regex - treat as no match
      return false;
    }
  }

  // 2. CEL Condition Match
  if (match.condition) {
    try {
      const result = CelExecutor.shared().execute(match.condition, {
        data: packet,
        len: packet.length,
      });
      if (!result) {
        return false;
      }
    } catch (e) {
      return false; // Error in CEL execution -> treat as no match
    }
  }

  // 3. Binary Data Match (if data is present)
  // Ensure we don't skip this if regex/condition matched but data is also provided.
  // All non-undefined constraints must match efficiently.
  if (match.data) {
    const offset = match.offset ?? defaultOffset ?? 0;
    const data = match.data;
    const mask = match.mask ?? data.map(() => 0xff);

    // Check if packet is long enough
    if (packet.length < offset + data.length) {
      return false;
    }

    // Check each byte
    for (let i = 0; i < data.length; i++) {
      const packetByte = packet[offset + i];
      const dataByte = data[i];
      const maskByte = mask[i] ?? 0xff;

      if ((packetByte & maskByte) !== (dataByte & maskByte)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if a packet matches the discovery match rules
 */
function matchesPacket(packet: number[], match: DiscoveryMatch, defaultOffset?: number): boolean {
  // Handle any_of (OR conditions)
  if (match.any_of && match.any_of.length > 0) {
    return match.any_of.some((subMatch) => matchesCondition(packet, subMatch, defaultOffset));
  }

  // Standard match
  return matchesCondition(packet, match, defaultOffset);
}

/**
 * Evaluate transform expression using CEL
 */
function evaluateTransform(value: number, transform: string, packet?: number[]): number {
  if (!transform) return value;

  // Optimization: Handle simple 'x' quickly
  if (transform.trim() === 'x') {
    return value;
  }

  try {
    const context: Record<string, any> = { x: value };
    if (packet) {
      context.data = packet;
      context.len = packet.length;
    }
    const result = CelExecutor.shared().execute(transform, context);
    return Number(result);
  } catch (e) {
    // Fallback or error logging? For now returning original value to be safe,
    // or arguably should return 0 or throw?
    // Given discovery context, safer to return 0 or log.
    return 0;
  }
}

/**
 * Extract value from a packet for a dimension
 */
function extractDimensionValue(packet: number[], dimension: DiscoveryDimension): number | null {
  const { offset, mask, transform, detect } = dimension;

  if (packet.length <= offset) {
    return null;
  }

  let value = packet[offset];

  // Apply mask if specified
  if (typeof mask === 'number') {
    value = value & mask;
  }

  // Apply transform if specified (CEL)
  if (transform) {
    value = evaluateTransform(value, transform, packet);
  }

  // Handle special detect modes
  if (detect === 'active_bits') {
    // Count the number of set bits
    let bits = 0;
    let v = value;
    while (v > 0) {
      bits += v & 1;
      v >>= 1;
    }
    return bits;
  }

  return value;
}

// ============================================================================
// Main Evaluation Function
// ============================================================================

/**
 * Evaluate a discovery schema against packet data
 */
export function evaluateDiscovery(
  discovery: DiscoverySchema,
  packetDictionary: Record<string, string>, // id -> hex string
  unmatchedPackets: string[], // hex strings
  defaultOffset?: number,
): DiscoveryResult {
  const allPackets = [...Object.values(packetDictionary), ...unmatchedPackets];

  // Parse and filter matching packets
  const matchedPackets: number[][] = [];
  for (const hexString of allPackets) {
    const bytes = hexToBytes(hexString);
    if (matchesPacket(bytes, discovery.match, defaultOffset)) {
      matchedPackets.push(bytes);
    }
  }

  if (matchedPackets.length === 0) {
    return {
      matched: false,
      matchedPacketCount: 0,
      parameterValues: {},
    };
  }

  // Extract dimension values from matched packets
  const dimensionValues: Record<string, number[]> = {};
  const dimensions = discovery.dimensions || [];

  for (const dim of dimensions) {
    dimensionValues[dim.parameter] = [];
  }

  for (const packet of matchedPackets) {
    for (const dim of dimensions) {
      const value = extractDimensionValue(packet, dim);
      if (value !== null) {
        dimensionValues[dim.parameter].push(value);
      }
    }
  }

  // Apply inference strategy
  const strategy = discovery.inference?.strategy ?? 'max';
  const parameterValues: Record<string, unknown> = {};

  switch (strategy) {
    case 'max':
      // Return maximum value for each dimension
      for (const [param, values] of Object.entries(dimensionValues)) {
        if (values.length > 0) {
          parameterValues[param] = Math.max(...values);
        }
      }
      break;

    case 'count':
      // Return unique value count for each dimension
      for (const [param, values] of Object.entries(dimensionValues)) {
        parameterValues[param] = new Set(values).size;
      }
      break;

    case 'unique_tuples':
      // Return array of unique tuples across all dimensions
      {
        const tuples = new Set<string>();
        const dimNames = Object.keys(dimensionValues);

        for (let i = 0; i < matchedPackets.length; i++) {
          const tuple: Record<string, number> = {};
          for (const dim of dimensions) {
            const value = extractDimensionValue(matchedPackets[i], dim);
            if (value !== null) {
              tuple[dim.parameter] = value;
            }
          }
          tuples.add(JSON.stringify(tuple));
        }

        const outputParam = discovery.inference?.output ?? 'items';
        parameterValues[outputParam] = Array.from(tuples).map((t) => JSON.parse(t));

        // Also provide individual counts
        for (const dim of dimNames) {
          parameterValues[`${dim}_count`] = new Set(dimensionValues[dim]).size;
        }
      }
      break;

    case 'grouped':
      // Group second dimension by first dimension
      {
        const dimNames = Object.keys(dimensionValues);
        if (dimNames.length >= 2) {
          const groups: Record<number, Set<number>> = {};

          for (let i = 0; i < matchedPackets.length; i++) {
            const packet = matchedPackets[i];
            const dim0 = dimensions[0];
            const dim1 = dimensions[1];

            const key = extractDimensionValue(packet, dim0);
            const val = extractDimensionValue(packet, dim1);

            if (key !== null && val !== null) {
              if (!groups[key]) {
                groups[key] = new Set();
              }
              groups[key].add(val);
            }
          }

          const outputParam = discovery.inference?.output ?? 'grouped';
          const groupedResult: Record<number, number> = {};
          for (const [k, v] of Object.entries(groups)) {
            groupedResult[Number(k)] = v.size;
          }
          parameterValues[outputParam] = groupedResult;

          // Also provide counts
          parameterValues[dimNames[0]] = Object.keys(groups).length;
          parameterValues[dimNames[1]] = Math.max(...Object.values(groups).map((s) => s.size), 0);
        }
      }
      break;
  }

  return {
    matched: true,
    matchedPacketCount: matchedPackets.length,
    parameterValues,
  };
}
