import { CelExecutor, CompiledScript } from '../protocol/cel-executor.js';
import { StateSchema } from '../protocol/types.js';

interface PacketMatchOptions {
  baseOffset?: number;
  context?: Record<string, any>;
  allowEmptyData?: boolean;
  preparedGuard?: CompiledScript | null;
  reusableContext?: Record<string, any>;
}

export function matchesPacket(
  match: StateSchema | null | undefined,
  packet: Uint8Array,
  options: PacketMatchOptions = {},
): boolean {
  if (!match) {
    return false;
  }
  const baseOffset = options.baseOffset ?? 0;
  const offset = (match.offset ?? 0) + baseOffset;
  const hasData = Array.isArray(match.data) && match.data.length > 0;
  let matched = true;

  if (hasData) {
    const dataLen = match.data!.length;
    // Optimization: Check bounds once before loop
    if (offset + dataLen > packet.length) {
      matched = false;
    } else {
      const matchData = match.data!;

      // Bolt Optimization: Loop unswitching to separate mask strategies
      // This eliminates repeated undefined checks and type guards in the hot loop
      if (match.mask === undefined) {
        // Path 1: No Mask (Fastest, Common Case)
        for (let i = 0; i < dataLen; i++) {
          if (packet[offset + i] !== matchData[i]) {
            matched = false;
            break;
          }
        }
      } else if (typeof match.mask === 'number') {
        // Path 2: Global Scalar Mask
        const mask = match.mask;
        for (let i = 0; i < dataLen; i++) {
          if ((packet[offset + i] & mask) !== (matchData[i] & mask)) {
            matched = false;
            break;
          }
        }
      } else if (Array.isArray(match.mask)) {
        // Path 3: Array Mask
        const maskArray = match.mask;
        for (let i = 0; i < dataLen; i++) {
          const mask = maskArray[i];
          if (mask !== undefined) {
            if ((packet[offset + i] & mask) !== (matchData[i] & mask)) {
              matched = false;
              break;
            }
          } else {
            if (packet[offset + i] !== matchData[i]) {
              matched = false;
              break;
            }
          }
        }
      }
    }
  } else if (!options.allowEmptyData) {
    return false;
  }

  matched = match.inverted ? !matched : matched;
  if (!matched) return false;

  if (match.guard) {
    let guardResult: any;
    if (options.preparedGuard && options.reusableContext) {
      // Optimization: Use prepared script and reusable context to avoid allocations
      guardResult = options.preparedGuard.executeRaw(options.reusableContext);
    } else {
      guardResult = CelExecutor.shared().execute(match.guard, {
        data: packet,
        ...(options.context ?? {}),
      });
    }
    if (!guardResult) return false;
  }

  if (match.except && match.except.length > 0) {
    for (const exceptSchema of match.except) {
      if (matchesPacket(exceptSchema, packet, options)) {
        return false;
      }
    }
  }

  return true;
}
