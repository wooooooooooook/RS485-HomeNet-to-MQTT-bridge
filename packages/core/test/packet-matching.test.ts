import { describe, it, expect } from 'vitest';

import { matchesPacket } from '../src/utils/packet-matching.js';
import { StateSchema } from '../src/protocol/types.js';

describe('matchesPacket', () => {
  it('should apply guard expression after data match', () => {
    const schema: StateSchema = {
      offset: 0,
      data: [0x01, 0x02],
      guard: 'data[2] == 0x03',
    };

    expect(matchesPacket(schema, Buffer.from([0x01, 0x02, 0x03]))).toBe(true);
    expect(matchesPacket(schema, Buffer.from([0x01, 0x02, 0x04]))).toBe(false);
  });

  it('should exclude packets that match an except schema', () => {
    const schema: StateSchema = {
      offset: 0,
      data: [0x01, 0x02],
      except: [
        {
          offset: 2,
          data: [0xff],
        },
      ],
    };

    expect(matchesPacket(schema, Buffer.from([0x01, 0x02, 0x10]))).toBe(true);
    expect(matchesPacket(schema, Buffer.from([0x01, 0x02, 0xff]))).toBe(false);
  });

  it('should return false if packet is too short for data', () => {
    const schema: StateSchema = {
      offset: 0,
      data: [0x01, 0x02, 0x03],
    };
    expect(matchesPacket(schema, Buffer.from([0x01, 0x02]))).toBe(false);
  });
});
