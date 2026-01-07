import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/config/index.js';
import { HomenetBridgeConfig } from '../src/config/types.js';

describe('설정 검증 - automation actions/then 중복', () => {
  it('then과 actions가 동시에 정의되면 예외를 던진다', () => {
    const config = {
      serial: {
        portId: 'a',
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      serials: [
        {
          portId: 'a',
          path: '/dev/ttyUSB0',
          baud_rate: 9600,
          data_bits: 8,
          parity: 'none',
          stop_bits: 1,
        },
      ],
      automation: [
        {
          id: 'auto1',
          trigger: [{ type: 'startup' }],
          then: [{ action: 'log', message: 'then' }],
          actions: [{ action: 'log', message: 'actions' }],
        },
      ],
    } as unknown as HomenetBridgeConfig;

    expect(() => validateConfig(config, config)).toThrow('then과 actions');
  });
});
