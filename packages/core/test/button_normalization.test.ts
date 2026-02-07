import { describe, it, expect, vi } from 'vitest';
import { normalizeConfig } from '../src/config/index';
import { HomenetBridgeConfig } from '../src/config/types';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

describe('Button Normalization', () => {
  it('should default discovery_always to true if discovery_linked_id is missing', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/tty', baud_rate: 9600 },
      button: [{ id: 'btn1', name: 'Button 1' }],
    };

    const normalized = normalizeConfig(config);
    const btn = normalized.button![0];
    expect(btn.discovery_always).toBe(true);
  });

  it('should not override discovery_always if discovery_linked_id is missing but discovery_always is set', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/tty', baud_rate: 9600 },
      button: [{ id: 'btn2', name: 'Button 2', discovery_always: false }],
    };

    const normalized = normalizeConfig(config);
    const btn = normalized.button![0];
    expect(btn.discovery_always).toBe(false);
  });

  it('should not default discovery_always if discovery_linked_id is present', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/tty', baud_rate: 9600 },
      button: [{ id: 'btn3', name: 'Button 3', discovery_linked_id: 'other_entity' }],
    };

    const normalized = normalizeConfig(config);
    const btn = normalized.button![0];
    expect(btn.discovery_always).toBeUndefined();
  });

  it('should not default discovery_always for other entity types (e.g. Light) even if discovery_linked_id is missing', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/tty', baud_rate: 9600 },
      light: [{ id: 'light1', name: 'Light 1' }],
    };

    const normalized = normalizeConfig(config);
    const light = normalized.light![0];
    expect(light.discovery_always).toBeUndefined();
  });
});
