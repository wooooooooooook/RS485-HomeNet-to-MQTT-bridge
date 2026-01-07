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

describe('Config Normalization', () => {
  it('should inject low_priority: true for automations with schedule trigger', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/tty', baud_rate: 9600 },
      light: [{ id: 'light1', name: 'Light 1' }],
      automation: [
        {
          id: 'auto1',
          trigger: [{ type: 'schedule', every_ms: '1s' }],
          then: [
            { action: 'command', target: 'id(light1).command_on()' },
            { action: 'log', message: 'test' },
          ],
        },
      ],
    };

    const normalized = normalizeConfig(config);
    const action = normalized.automation![0].then[0] as any;
    expect(action.action).toBe('command');
    expect(action.low_priority).toBe(true);
  });

  it('should not override explicit low_priority setting', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/tty', baud_rate: 9600 },
      light: [{ id: 'light1', name: 'Light 1' }],
      automation: [
        {
          id: 'auto1',
          trigger: [{ type: 'schedule', every_ms: '1s' }],
          then: [{ action: 'command', target: 'id(light1).command_on()', low_priority: false }],
        },
      ],
    };

    const normalized = normalizeConfig(config);
    const action = normalized.automation![0].then[0] as any;
    expect(action.low_priority).toBe(false);
  });

  it('should not inject low_priority for non-schedule automations', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/tty', baud_rate: 9600 },
      light: [{ id: 'light1', name: 'Light 1' }],
      automation: [
        {
          id: 'auto1',
          trigger: [{ type: 'state', entity_id: 'light1' }],
          then: [{ action: 'command', target: 'id(light1).command_on()' }],
        },
      ],
    };

    const normalized = normalizeConfig(config);
    const action = normalized.automation![0].then[0] as any;
    expect(action.low_priority).toBeUndefined();
  });

  it('should map automation actions to then when then is missing', () => {
    const config: any = {
      serial: { portId: 'test', path: '/dev/tty', baud_rate: 9600 },
      light: [{ id: 'light1', name: 'Light 1' }],
      automation: [
        {
          id: 'auto1',
          trigger: [{ type: 'state', entity_id: 'light1' }],
          actions: [{ action: 'command', target: 'id(light1).command_on()' }],
        },
      ],
    };

    const normalized = normalizeConfig(config);
    expect(normalized.automation![0].then).toEqual([
      { action: 'command', target: 'id(light1).command_on()' },
    ]);
    expect((normalized.automation![0] as any).actions).toBeUndefined();
  });
});
