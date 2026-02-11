
import { normalizeConfig } from '../src/config/index.js';
import { describe, it, expect } from 'vitest';

describe('Config Leniency', () => {
  it('should treat state_text as state_number for sensor', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/test', baud_rate: 9600 },
      sensor: [
        {
          id: 'test_sensor',
          state: { data: [0x01] },
          state_text: { offset: 1, length: 1, type: 'byte' } // Wrong property
        }
      ]
    };

    normalizeConfig(config);

    expect(config.sensor[0].state_number).toBeDefined();
    expect(config.sensor[0].state_number.offset).toBe(1);
  });

  it('should treat state_value as state_text for text_sensor', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/test', baud_rate: 9600 },
      text_sensor: [
        {
          id: 'test_text',
          state: { data: [0x02] },
          state_value: { offset: 2, length: 2 } // Wrong property
        }
      ]
    };

    normalizeConfig(config);

    expect(config.text_sensor[0].state_text).toBeDefined();
    expect(config.text_sensor[0].state_text.offset).toBe(2);
  });

  it('should treat state_value as state_number for sensor', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/test', baud_rate: 9600 },
      sensor: [
        {
          id: 'test_sensor_val',
          state: { data: [0x03] },
          state_value: { offset: 3, length: 1 } // Wrong property
        }
      ]
    };

    normalizeConfig(config);

    expect(config.sensor[0].state_number).toBeDefined();
    expect(config.sensor[0].state_number.offset).toBe(3);
  });

  it('should treat state_number as state_text for text_sensor', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/test', baud_rate: 9600 },
      text_sensor: [
        {
          id: 'test_text_num',
          state: { data: [0x04] },
          state_number: { offset: 4, length: 4 } // Wrong property
        }
      ]
    };

    normalizeConfig(config);

    expect(config.text_sensor[0].state_text).toBeDefined();
    expect(config.text_sensor[0].state_text.offset).toBe(4);
  });
});
