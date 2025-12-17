import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/config/index.js';
import { HomenetBridgeConfig } from '../src/config/types.js';

describe('설정 검증 - 단일 시리얼 제한', () => {
  it('serials 키를 사용하면 예외를 던진다', () => {
    const rawConfig = {
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
      light: [{ id: 'light1' }],
    } as unknown as HomenetBridgeConfig;

    expect(() => validateConfig(rawConfig, rawConfig)).toThrow(
      'serials 키는 더 이상 지원되지 않습니다',
    );
  });

  it('mqtt_topic_prefix가 설정 파일에 존재하면 예외를 던진다', () => {
    const config = {
      mqtt_topic_prefix: 'test',
      serial: {
        portId: 'a',
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      } as any,
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
      light: [{ id: 'light1' }],
    } as unknown as HomenetBridgeConfig;

    expect(() => validateConfig(config, config)).toThrow('mqtt_topic_prefix');
  });
});
