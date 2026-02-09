import { describe, it, expect } from 'vitest';
import { findEntityById, ENTITY_TYPE_KEYS } from '../src/utils/entities.js';
import { HomenetBridgeConfig } from '../src/config/types.js';

describe('Entities Utilities', () => {
  describe('findEntityById', () => {
    const mockConfig = {
      serial: {
        portId: 'default',
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      light: [
        { id: 'light_1', name: 'Light 1' },
        { id: 'light_2', name: 'Light 2' },
      ],
      switch: [
        { id: 'switch_1', name: 'Switch 1' },
      ],
      sensor: [],
    } as unknown as HomenetBridgeConfig;

    it('should find a light entity by id', () => {
      const result = findEntityById(mockConfig, 'light_1');
      expect(result).toBeDefined();
      expect(result?.id).toBe('light_1');
      expect(result?.name).toBe('Light 1');
      expect(result?.type).toBe('light');
    });

    it('should find a switch entity by id', () => {
      const result = findEntityById(mockConfig, 'switch_1');
      expect(result).toBeDefined();
      expect(result?.id).toBe('switch_1');
      expect(result?.type).toBe('switch');
    });

    it('should return undefined for non-existent entity id', () => {
      const result = findEntityById(mockConfig, 'non_existent');
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty categories', () => {
      const result = findEntityById(mockConfig, 'sensor_1');
      expect(result).toBeUndefined();
    });

    it('should handle missing categories in config', () => {
      const partialConfig = {
        serial: mockConfig.serial,
        light: [{ id: 'light_only', name: 'Only Light' }],
      } as unknown as HomenetBridgeConfig;

      const result = findEntityById(partialConfig, 'light_only');
      expect(result?.id).toBe('light_only');
      expect(result?.type).toBe('light');

      const resultNotFound = findEntityById(partialConfig, 'switch_1');
      expect(resultNotFound).toBeUndefined();
    });

    it('should check all ENTITY_TYPE_KEYS', () => {
      // Create a config with one entity for each type
      const fullConfig = {
        serial: mockConfig.serial,
      } as any;

      ENTITY_TYPE_KEYS.forEach((type, index) => {
        fullConfig[type] = [{ id: `${type}_${index}`, name: `${type} entity` }];
      });

      ENTITY_TYPE_KEYS.forEach((type, index) => {
        const id = `${type}_${index}`;
        const result = findEntityById(fullConfig as HomenetBridgeConfig, id);
        expect(result).toBeDefined();
        expect(result?.id).toBe(id);
        expect(result?.type).toBe(type);
      });
    });
  });
});
