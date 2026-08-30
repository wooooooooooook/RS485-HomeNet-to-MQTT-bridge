import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createControlsRoutes, ControlsRoutesContext } from '../../src/routes/controls.routes.js';
import { RateLimiter } from '../../src/utils/rate-limiter.js';
import { BridgeInstance, ConfigStatus, BridgeErrorPayload } from '../../src/types/index.js';
import { HomenetBridgeConfig } from '@rs485-homenet/core';

describe('Controls Routes - Optimistic Switch', () => {
  let app: express.Application;
  let mockRateLimiter: RateLimiter;
  let mockCtx: ControlsRoutesContext;
  let mockBridge: any;

  const optimisticSwitchConfig = {
    switch: [
      {
        id: 'opt_switch',
        name: 'Optimistic Switch',
        optimistic: true,
        // No command_on/off defined
      },
    ],
  };

  beforeEach(() => {
    mockRateLimiter = {
      check: vi.fn().mockReturnValue(true),
    } as unknown as RateLimiter;

    mockBridge = {
      bridge: {
        executeCommand: vi.fn().mockResolvedValue({ success: true }),
      },
      configFile: 'homenet_bridge.yaml',
    };

    mockCtx = {
      commandRateLimiter: mockRateLimiter,
      configRateLimiter: mockRateLimiter,
      getBridges: vi.fn().mockReturnValue([mockBridge]),
      getCurrentConfigs: vi.fn().mockReturnValue([optimisticSwitchConfig]),
      getCurrentConfigFiles: vi.fn().mockReturnValue(['homenet_bridge.yaml']),
      getCurrentRawConfigs: vi.fn().mockReturnValue([optimisticSwitchConfig]),
      getCurrentConfigStatuses: vi.fn().mockReturnValue(['started']),
      getCurrentConfigErrors: vi.fn().mockReturnValue([null]),
      configDir: '/tmp',
      setCurrentConfigs: vi.fn(),
      setCurrentRawConfigs: vi.fn(),
      rebuildPortMappings: vi.fn(),
    } as unknown as ControlsRoutesContext;

    app = express();
    app.use(express.json());
    app.use('/', createControlsRoutes(mockCtx));
  });

  it('should list implicit commands for optimistic switch', async () => {
    const response = await request(app).get('/api/commands');
    expect(response.status).toBe(200);
    const commands = response.body.commands;

    const onCommand = commands.find(
      (c: any) => c.entityId === 'opt_switch' && c.commandName === 'command_on',
    );
    const offCommand = commands.find(
      (c: any) => c.entityId === 'opt_switch' && c.commandName === 'command_off',
    );

    expect(onCommand).toBeDefined();
    expect(onCommand.displayName).toContain('On');
    expect(offCommand).toBeDefined();
    expect(offCommand.displayName).toContain('Off');
  });

  it('should execute optimistic command even if not listed', async () => {
    const response = await request(app).post('/api/commands/execute').send({
      entityId: 'opt_switch',
      commandName: 'command_on',
    });

    expect(response.status).toBe(200);
    expect(mockBridge.bridge.executeCommand).toHaveBeenCalledWith('opt_switch', 'on', undefined);
  });
});

describe('Controls Routes - Climate Temperature Parsing', () => {
  it('should handle numeric visual temperature bounds without crashing', async () => {
    const mockRateLimiter = {
      check: vi.fn().mockReturnValue(true),
    } as unknown as RateLimiter;

    const climateConfig = {
      climate: [
        {
          id: 'living_room_climate',
          name: 'Living Room Climate',
          command_temperature: {},
          visual: {
            min_temperature: 18,
            max_temperature: 30,
            temperature_step: 0.5,
          },
        },
      ],
    };

    const mockCtx = {
      commandRateLimiter: mockRateLimiter,
      configRateLimiter: mockRateLimiter,
      getBridges: vi.fn().mockReturnValue([]),
      getCurrentConfigs: vi.fn().mockReturnValue([climateConfig]),
      getCurrentConfigFiles: vi.fn().mockReturnValue(['homenet_bridge.yaml']),
      getCurrentRawConfigs: vi.fn().mockReturnValue([climateConfig]),
      getCurrentConfigStatuses: vi.fn().mockReturnValue(['started' satisfies ConfigStatus]),
      getCurrentConfigErrors: vi.fn().mockReturnValue([null satisfies BridgeErrorPayload | null]),
      configDir: '/tmp',
      setCurrentConfigs: vi.fn(),
      setCurrentRawConfigs: vi.fn(),
      rebuildPortMappings: vi.fn(),
    } as unknown as ControlsRoutesContext;

    const app = express();
    app.use(express.json());
    app.use('/', createControlsRoutes(mockCtx));

    const response = await request(app).get('/api/commands');
    expect(response.status).toBe(200);

    const tempCommand = response.body.commands.find(
      (c: any) => c.entityId === 'living_room_climate' && c.commandName === 'command_temperature',
    );
    expect(tempCommand).toBeDefined();
    expect(tempCommand.min).toBe(18);
    expect(tempCommand.max).toBe(30);
    expect(tempCommand.step).toBe(0.5);
  });
});

describe('Controls Routes - Path Traversal Prevention', () => {
  it('should return 404 when target config file attempts path traversal', async () => {
    const mockRateLimiter = {
      check: vi.fn().mockReturnValue(true),
    } as unknown as RateLimiter;

    const configWithAutomation = {
      automation: [
        {
          id: 'auto_test',
          name: 'Test Automation',
          trigger: [],
          action: [],
        },
      ],
      scripts: [
        {
          id: 'script_test',
          name: 'Test Script',
          sequence: [],
        },
      ],
    };

    const mockCtx = {
      commandRateLimiter: mockRateLimiter,
      configRateLimiter: mockRateLimiter,
      getBridges: vi.fn().mockReturnValue([]),
      getCurrentConfigs: vi.fn().mockReturnValue([configWithAutomation]),
      getCurrentConfigFiles: vi.fn().mockReturnValue(['../../../etc/passwd']),
      getCurrentRawConfigs: vi.fn().mockReturnValue([configWithAutomation]),
      getCurrentConfigStatuses: vi.fn().mockReturnValue(['started']),
      getCurrentConfigErrors: vi.fn().mockReturnValue([null]),
      configDir: '/tmp/homenet-config',
      setCurrentConfigs: vi.fn(),
      setCurrentRawConfigs: vi.fn(),
      rebuildPortMappings: vi.fn(),
    } as unknown as ControlsRoutesContext;

    const app = express();
    app.use(express.json());
    app.use('/', createControlsRoutes(mockCtx));

    // Toggle automation
    const toggleRes = await request(app)
      .patch('/api/automations/auto_test/enabled')
      .send({ enabled: true });
    expect(toggleRes.status).toBe(404);
    expect(toggleRes.body.error).toBe('Config file not found');

    // Delete automation
    const deleteAutoRes = await request(app).delete('/api/automations/auto_test');
    expect(deleteAutoRes.status).toBe(404);
    expect(deleteAutoRes.body.error).toBe('Config file not found');

    // Delete script
    const deleteScriptRes = await request(app).delete('/api/scripts/script_test');
    expect(deleteScriptRes.status).toBe(404);
    expect(deleteScriptRes.body.error).toBe('Config file not found');
  });
});

describe('Controls Routes - Failed Bridge Guard', () => {
  it('should return 503 when target bridge is in error state', async () => {
    const mockRateLimiter = {
      check: vi.fn().mockReturnValue(true),
    } as unknown as RateLimiter;

    const failedConfig = {
      light: [
        {
          id: 'living_light',
          name: 'Living Light',
          command_on: {},
        },
      ],
      automation: [
        {
          id: 'auto_failed',
          name: 'Failed Auto',
          trigger: [],
          action: [],
        },
      ],
      scripts: [
        {
          id: 'script_failed',
          name: 'Failed Script',
          sequence: [],
        },
      ],
    };

    const mockBridge = {
      configFile: 'failed_bridge.yaml',
      bridge: {
        executeCommand: vi.fn(),
      },
    };

    const mockCtx = {
      commandRateLimiter: mockRateLimiter,
      configRateLimiter: mockRateLimiter,
      getBridges: vi.fn().mockReturnValue([mockBridge]),
      getCurrentConfigs: vi.fn().mockReturnValue([failedConfig]),
      getCurrentConfigFiles: vi.fn().mockReturnValue(['failed_bridge.yaml']),
      getCurrentRawConfigs: vi.fn().mockReturnValue([failedConfig]),
      getCurrentConfigStatuses: vi.fn().mockReturnValue(['error']),
      getCurrentConfigErrors: vi.fn().mockReturnValue([
        {
          code: 'CORE_START_FAILED',
          message: 'Serial port disconnected',
        },
      ]),
      configDir: '/tmp',
      setCurrentConfigs: vi.fn(),
      setCurrentRawConfigs: vi.fn(),
      rebuildPortMappings: vi.fn(),
    } as unknown as ControlsRoutesContext;

    const app = express();
    app.use(express.json());
    app.use('/', createControlsRoutes(mockCtx));

    // 1. Command execute
    const cmdRes = await request(app).post('/api/commands/execute').send({
      entityId: 'living_light',
      commandName: 'command_on',
    });
    expect(cmdRes.status).toBe(503);
    expect(cmdRes.body.error).toContain('Bridge for this entity is not active');
    expect(mockBridge.bridge.executeCommand).not.toHaveBeenCalled();

    // 2. Automation execute
    const autoRes = await request(app).post('/api/automations/execute').send({
      automationId: 'auto_failed',
    });
    expect(autoRes.status).toBe(503);
    expect(autoRes.body.error).toContain('Bridge for this automation is not active');

    // 3. Script execute
    const scriptRes = await request(app).post('/api/scripts/execute').send({
      scriptId: 'script_failed',
    });
    expect(scriptRes.status).toBe(503);
    expect(scriptRes.body.error).toContain('Bridge for this script is not active');
  });
});
