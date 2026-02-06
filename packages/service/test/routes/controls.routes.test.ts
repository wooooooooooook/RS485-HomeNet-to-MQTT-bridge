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
