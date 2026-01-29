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
    for (let i = 0; i < match.data!.length; i++) {
      const expected = match.data![i];
      const packetByte = packet[offset + i];
      if (packetByte === undefined) {
        matched = false;
        break;
      }
      const mask = Array.isArray(match.mask) ? match.mask[i] : match.mask;
      const maskedPacket = mask !== undefined ? packetByte & mask : packetByte;
      const maskedExpected = mask !== undefined ? expected & mask : expected;
      if (maskedPacket !== maskedExpected) {
        matched = false;
        break;
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
