import { describe, it, expect } from 'vitest';
import { dumpConfigToYaml } from '../../src/utils/yaml-dumper.js';
import { ENTITY_TYPE_KEYS } from '../../src/utils/constants.js';

describe('dumpConfigToYaml', () => {
  it('should serialize basic object to YAML', () => {
    const config = {
      name: 'Test Device',
      port: 8080,
    };
    const yaml = dumpConfigToYaml(config);
    expect(yaml).toContain('name: Test Device');
    expect(yaml).toContain('port: 8080');
  });

  it('should convert number arrays to hex sequences for specific keys', () => {
    const config = {
      state: [1, 10, 255],
      command_on: [2, 11, 254],
      header: [3, 12, 253],
      my_footer_key: [4, 13, 252],
      ack: [5, 14, 251],
      mask: [6, 15, 250],
      data: [7, 16, 249],
    };
    const yaml = dumpConfigToYaml(config);
    expect(yaml).toContain('state: [0x01, 0x0A, 0xFF]');
    expect(yaml).toContain('command_on: [0x02, 0x0B, 0xFE]');
    expect(yaml).toContain('header: [0x03, 0x0C, 0xFD]');
    expect(yaml).toContain('my_footer_key: [0x04, 0x0D, 0xFC]');
    expect(yaml).toContain('ack: [0x05, 0x0E, 0xFB]');
    expect(yaml).toContain('mask: [0x06, 0x0F, 0xFA]');
    expect(yaml).toContain('data: [0x07, 0x10, 0xF9]');
  });

  it('should not convert number arrays for normal keys', () => {
    const config = {
      normal_array: [1, 10, 255],
    };
    const yaml = dumpConfigToYaml(config);
    expect(yaml).toContain('normal_array:\n  - 1\n  - 10\n  - 255');
  });

  it('should filter out redundant unique_id and specific type keys', () => {
    const config = {
      unique_id: 'some-id',
      type: ENTITY_TYPE_KEYS[0], // 'light'
      keep_type: 'unknown_type',
    };
    const yaml = dumpConfigToYaml(config);
    expect(yaml).not.toContain('unique_id');
    expect(yaml).not.toContain(`type: ${ENTITY_TYPE_KEYS[0]}`);
    expect(yaml).toContain('keep_type: unknown_type'); // should be kept

    const config2 = { type: 'unknown_type' }; // type is not in ENTITY_TYPE_KEYS
    const yaml2 = dumpConfigToYaml(config2);
    expect(yaml2).toContain('type: unknown_type');
  });

  it('should handle arrays inside arrays', () => {
    const config = {
      list: [{ state: [1, 2] }, { normal: [3, 4] }],
    };
    const yaml = dumpConfigToYaml(config);
    expect(yaml).toContain('state: [0x01, 0x02]');
    expect(yaml).toContain('normal:\n      - 3\n      - 4'); // indent is different based on yaml formatting
  });

  it('should pass through non-plain objects like Date', () => {
    const date = new Date('2023-01-01T00:00:00Z');
    const config = {
      date_val: date,
    };
    const yaml = dumpConfigToYaml(config);
    expect(yaml).toContain('date_val: 2023-01-01T00:00:00.000Z');
  });

  it('should not convert arrays with non-number items even in specific keys', () => {
    const config = {
      state: [1, 'string', 2],
      data: [{ a: 1 }],
      empty: [], // empty array
    };
    const yaml = dumpConfigToYaml(config);
    expect(yaml).toContain('state:\n  - 1\n  - string\n  - 2');
    expect(yaml).toContain('data:\n  - a: 1');
    expect(yaml).toContain('empty: []');
  });

  it('should recursively handle nested objects', () => {
    const config = {
      device: {
        state: [10, 20],
        nested: {
          data: [30, 40],
        },
      },
      state_on: {
        data: [50, 60],
      },
    };
    const yaml = dumpConfigToYaml(config);
    expect(yaml).toContain('state: [0x0A, 0x14]');
    expect(yaml).toContain('data: [0x1E, 0x28]');
    expect(yaml).toContain('data: [0x32, 0x3C]');
  });
});
