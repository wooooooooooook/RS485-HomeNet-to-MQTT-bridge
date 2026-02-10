import { describe, it, expect } from 'vitest';
import { normalizeDeviceState } from '../../../src/protocol/devices/state-normalizer';

describe('normalizeDeviceState', () => {
  describe('Basic Entity Types (Switch, Binary Sensor, Light)', () => {
    it('should normalize ON state for switch', () => {
      const config = {
        type: 'switch',
        state_on: { offset: 0, data: [0x01] },
        state_off: { offset: 0, data: [0x00] },
      };
      const payload = new Uint8Array([0x01]);
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({ state: 'ON' });
    });

    it('should normalize OFF state for switch', () => {
      const config = {
        type: 'switch',
        state_on: { offset: 0, data: [0x01] },
        state_off: { offset: 0, data: [0x00] },
      };
      const payload = new Uint8Array([0x00]);
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({ state: 'OFF' });
    });

    it('should normalize ON state for binary_sensor', () => {
      const config = {
        type: 'binary_sensor',
        state_on: { offset: 0, data: [0x01] },
        state_off: { offset: 0, data: [0x00] },
      };
      const payload = new Uint8Array([0x01]);
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({ state: 'ON' });
    });
  });

  describe('Light Entity', () => {
    it('should normalize brightness', () => {
      const config = {
        type: 'light',
        state_brightness: { offset: 1, length: 1 },
      };
      const payload = new Uint8Array([0x00, 0x64]); // 100 decimal
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({ brightness: 100 });
    });

    it('should normalize RGB and white values', () => {
      const config = {
        type: 'light',
        state_red: { offset: 0, length: 1 },
        state_green: { offset: 1, length: 1 },
        state_blue: { offset: 2, length: 1 },
        state_white: { offset: 3, length: 1 },
      };
      const payload = new Uint8Array([0xFF, 0x00, 0x80, 0x40]);
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({
        red: 255,
        green: 0,
        blue: 128,
        white: 64,
      });
    });

    it('should normalize color temperature', () => {
      const config = {
        type: 'light',
        state_color_temp: { offset: 0, length: 1 },
      };
      const payload = new Uint8Array([0x32]); // 50 decimal
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({ color_temp: 50 });
    });
  });

  describe('Fan Entity', () => {
    it('should normalize speed and percentage', () => {
      const config = {
        type: 'fan',
        state_speed: { offset: 0, length: 1 },
        state_percentage: { offset: 1, length: 1 },
      };
      const payload = new Uint8Array([0x03, 0x4B]); // Speed 3, 75%
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({ speed: 3, percentage: 75 });
    });

    it('should normalize oscillating state', () => {
      const config = {
        type: 'fan',
        state_oscillating: { offset: 0, data: [0x01] },
      };
      const payload = new Uint8Array([0x01]);
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({ oscillating: true });
    });

    it('should normalize direction', () => {
      const config = {
        type: 'fan',
        state_direction: { offset: 0, length: 1 },
      };

      // Forward (0)
      let payload = new Uint8Array([0x00]);
      let result = normalizeDeviceState(config, payload, { direction: true });
      expect(result).toEqual({ direction: 'forward' });

      // Reverse (non-zero)
      payload = new Uint8Array([0x01]);
      result = normalizeDeviceState(config, payload, { direction: true });
      expect(result).toEqual({ direction: 'reverse' });
    });
  });

  describe('Climate Entity', () => {
    it('should normalize current and target temperatures', () => {
      const config = {
        type: 'climate',
        state_temperature_current: { offset: 0, length: 1 },
        state_temperature_target: { offset: 1, length: 1 },
      };
      const payload = new Uint8Array([0x14, 0x16]); // 20, 22
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({
        current_temperature: 20,
        target_temperature: 22,
      });
    });

    it('should normalize modes (off, heat, cool)', () => {
      const config = {
        type: 'climate',
        state_off: { offset: 0, data: [0x00] },
        state_heat: { offset: 0, data: [0x01] },
        state_cool: { offset: 0, data: [0x02] },
      };

      // When mode is off, action defaults to off if undefined.
      expect(normalizeDeviceState(config, new Uint8Array([0x00]), {})).toEqual({ mode: 'off', action: 'off' });
      expect(normalizeDeviceState(config, new Uint8Array([0x01]), {})).toEqual({ mode: 'heat' });
      expect(normalizeDeviceState(config, new Uint8Array([0x02]), {})).toEqual({ mode: 'cool' });
    });

    it('should normalize actions', () => {
      const config = {
        type: 'climate',
        state_action_heating: { offset: 0, data: [0x01] },
        state_action_idle: { offset: 0, data: [0x00] },
      };

      expect(normalizeDeviceState(config, new Uint8Array([0x01]), {})).toEqual({ action: 'heating' });
      expect(normalizeDeviceState(config, new Uint8Array([0x00]), {})).toEqual({ action: 'idle' });
    });

    it('should normalize fan modes', () => {
      const config = {
        type: 'climate',
        state_fan_low: { offset: 0, data: [0x01] },
        state_fan_high: { offset: 0, data: [0x02] },
      };

      expect(normalizeDeviceState(config, new Uint8Array([0x01]), {})).toEqual({ fan_mode: 'low' });
      expect(normalizeDeviceState(config, new Uint8Array([0x02]), {})).toEqual({ fan_mode: 'high' });
    });

    it('should fallback to custom_fan if fan_mode not matched', () => {
         const config = { type: 'climate' };
         const updates = { custom_fan: 'my_custom_mode' };
         const result = normalizeDeviceState(config, new Uint8Array([]), updates);
         expect(result).toEqual({ custom_fan: 'my_custom_mode', fan_mode: 'my_custom_mode' });
    });

     it('should fallback to custom_preset if preset_mode not matched', () => {
         const config = { type: 'climate' };
         const updates = { custom_preset: 'my_preset' };
         const result = normalizeDeviceState(config, new Uint8Array([]), updates);
         expect(result).toEqual({ custom_preset: 'my_preset', preset_mode: 'my_preset' });
    });
  });

  describe('Valve Entity', () => {
    it('should normalize states', () => {
      const config = {
        type: 'valve',
        state_open: { offset: 0, data: [0x01] },
        state_closed: { offset: 0, data: [0x00] },
      };

      expect(normalizeDeviceState(config, new Uint8Array([0x01]), {})).toEqual({ state: 'OPEN' });
      expect(normalizeDeviceState(config, new Uint8Array([0x00]), {})).toEqual({ state: 'CLOSED' });
    });

    it('should normalize position', () => {
      const config = {
        type: 'valve',
        state_position: { offset: 0, length: 1 },
      };

      // Normal range
      expect(normalizeDeviceState(config, new Uint8Array([0x32]), {})).toEqual({ position: 50 });
      // Clamping
      expect(normalizeDeviceState(config, new Uint8Array([0x70]), {})).toEqual({ position: 100 }); // > 100
    });
  });

  describe('Number / Sensor Entity', () => {
    it('should extract simple value', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 0, length: 1 },
      };
      expect(normalizeDeviceState(config, new Uint8Array([0x0A]), {})).toEqual({ value: 10 });
    });

    it('should handle multi-byte values (big endian)', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 0, length: 2, endian: 'big' },
      };
      // 0x0102 = 258
      expect(normalizeDeviceState(config, new Uint8Array([0x01, 0x02]), {})).toEqual({ value: 258 });
    });

    it('should handle multi-byte values (little endian)', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 0, length: 2, endian: 'little' },
      };
      // 0x0201 = 258
      expect(normalizeDeviceState(config, new Uint8Array([0x02, 0x01]), {})).toEqual({ value: 258 });
    });

    it('should handle BCD decoding', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 0, length: 1, decode: 'bcd' },
      };
      // 0x12 -> 12
      expect(normalizeDeviceState(config, new Uint8Array([0x12]), {})).toEqual({ value: 12 });
    });

    it('should handle signed values', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 0, length: 1, signed: true },
      };
      // 0xFF -> -1 (255 - 256)
      expect(normalizeDeviceState(config, new Uint8Array([0xFF]), {})).toEqual({ value: -1 });
      // 0x7F -> 127
      expect(normalizeDeviceState(config, new Uint8Array([0x7F]), {})).toEqual({ value: 127 });
    });

    it('should handle precision', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 0, length: 1, precision: 1 },
      };
      // 0x14 = 20 -> 2.0
      expect(normalizeDeviceState(config, new Uint8Array([0x14]), {})).toEqual({ value: 2 });
       // 0x15 = 21 -> 2.1
      expect(normalizeDeviceState(config, new Uint8Array([0x15]), {})).toEqual({ value: 2.1 });
    });

     it('should handle ASCII decoding', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 0, length: 3, decode: 'ascii' },
      };
      // 'ABC'
      expect(normalizeDeviceState(config, new Uint8Array([0x41, 0x42, 0x43]), {})).toEqual({ value: 'ABC' });
    });

     it('should handle ASCII decoding little endian', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 0, length: 3, decode: 'ascii', endian: 'little' },
      };
      // 'CBA' -> 'ABC' (reversed)
      expect(normalizeDeviceState(config, new Uint8Array([0x43, 0x42, 0x41]), {})).toEqual({ value: 'ABC' });
    });

    it('should handle mapping', () => {
        const config = {
            type: 'sensor',
            state_number: { offset: 0, length: 1, mapping: { 10: 'ten' } },
        };
        expect(normalizeDeviceState(config, new Uint8Array([0x0A]), {})).toEqual({ value: 'ten' });
        expect(normalizeDeviceState(config, new Uint8Array([0x0B]), {})).toEqual({ value: 11 });
    });
  });

  describe('Number Entity Actions', () => {
      it('should detect increment/decrement actions', () => {
          const config = {
              type: 'number',
              state_increment: { offset: 0, data: [0x01] },
              state_decrement: { offset: 0, data: [0x02] }
          };
          expect(normalizeDeviceState(config, new Uint8Array([0x01]), {})).toEqual({ action: 'increment' });
          expect(normalizeDeviceState(config, new Uint8Array([0x02]), {})).toEqual({ action: 'decrement' });
      });
       it('should detect to_min/to_max actions', () => {
          const config = {
              type: 'number',
              min_value: 0,
              max_value: 100,
              state_to_min: { offset: 0, data: [0x01] },
              state_to_max: { offset: 0, data: [0x02] }
          };
          expect(normalizeDeviceState(config, new Uint8Array([0x01]), {})).toEqual({ value: 0 });
          expect(normalizeDeviceState(config, new Uint8Array([0x02]), {})).toEqual({ value: 100 });
      });
  });

  describe('Select Entity', () => {
    it('should extract option from map', () => {
      const config = {
        type: 'select',
        state_select: {
          offset: 0,
          length: 1,
          map: { 1: 'option1', 2: 'option2' },
        },
      };
      expect(normalizeDeviceState(config, new Uint8Array([0x01]), {})).toEqual({ option: 'option1' });
      expect(normalizeDeviceState(config, new Uint8Array([0x02]), {})).toEqual({ option: 'option2' });
      expect(normalizeDeviceState(config, new Uint8Array([0x03]), {})).toEqual({}); // No match
    });
  });

  describe('Lock Entity', () => {
    it('should normalize lock states', () => {
      const config = {
        type: 'lock',
        state_locked: { offset: 0, data: [0x01] },
        state_unlocked: { offset: 0, data: [0x00] },
      };

      expect(normalizeDeviceState(config, new Uint8Array([0x01]), {})).toEqual({ state: 'LOCKED' });
      expect(normalizeDeviceState(config, new Uint8Array([0x00]), {})).toEqual({ state: 'UNLOCKED' });
    });

     it('should clean up boolean flags', () => {
         const config = {
            type: 'lock',
            state_locked: { offset: 0, data: [0x01] },
        };
         const updates = { locked: true };
         const result = normalizeDeviceState(config, new Uint8Array([0x00]), updates);
         expect(result.locked).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle payload shorter than offset + length', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 5, length: 1 },
      };
      const payload = new Uint8Array([0x01, 0x02]);
      const result = normalizeDeviceState(config, payload, {});
      expect(result).toEqual({}); // Should return null value internally and not set property
    });

    it('should respect headerLen option', () => {
      const config = {
        type: 'sensor',
        state_number: { length: 1 }, // offset undefined, uses headerLen
      };
      const payload = new Uint8Array([0xAA, 0xBB, 0xCC]);
      // headerLen = 1, so offset = 1. Value at index 1 is 0xBB (187)
      const result = normalizeDeviceState(config, payload, {}, { headerLen: 1 });
      expect(result).toEqual({ value: 187 });
    });

    it('should use explicit offset over headerLen', () => {
      const config = {
        type: 'sensor',
        state_number: { offset: 0, length: 1 }, // offset defined
      };
      const payload = new Uint8Array([0xAA, 0xBB, 0xCC]);
      // offset 0, value 0xAA (170)
      const result = normalizeDeviceState(config, payload, {}, { headerLen: 1 });
      expect(result).toEqual({ value: 170 });
    });
  });
});
