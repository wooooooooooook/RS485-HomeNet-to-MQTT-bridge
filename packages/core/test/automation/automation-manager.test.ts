import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AutomationManager } from '../../src/automation/automation-manager.js';
import { eventBus } from '../../src/service/event-bus.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';

const baseConfig: HomenetBridgeConfig = {
  serial: { baud_rate: 9600, data_bits: 8, parity: 'none', stop_bits: 1 },
  light: [{ id: 'light_1', name: 'Light 1', type: 'light' }],
};

describe('AutomationManager', () => {
  let automationManager: AutomationManager | undefined;
  let packetProcessor: EventEmitter & { constructCommandPacket: ReturnType<typeof vi.fn> };
  let commandManager: { send: ReturnType<typeof vi.fn> };
  let mqttPublisher: { publish: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    packetProcessor = Object.assign(new EventEmitter(), {
      constructCommandPacket: vi.fn(),
    });
    commandManager = { send: vi.fn().mockResolvedValue(undefined) };
    mqttPublisher = { publish: vi.fn() };
  });

  afterEach(() => {
    automationManager?.stop();
    eventBus.removeAllListeners();
  });

  it('publishes MQTT when state trigger matches', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'pub_on_state',
          trigger: [
            {
              type: 'state',
              entity_id: 'light_1',
              property: 'state_on',
              match: true,
            },
          ],
          then: [
            {
              action: 'publish',
              topic: 'automation/test',
              payload: 'on',
            },
          ],
        },
      ],
    };

    automationManager = new AutomationManager(config, packetProcessor as any, commandManager as any, mqttPublisher as any);
    automationManager.start();

    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mqttPublisher.publish).toHaveBeenCalledWith('automation/test', 'on', undefined);
  });

  it('executes command action using parsed target', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'command_on_state',
          trigger: [
            {
              type: 'state',
              entity_id: 'light_1',
              property: 'state_on',
              match: true,
            },
          ],
          then: [
            {
              action: 'command',
              target: 'id(light_1).command_on()',
            },
          ],
        },
      ],
    };

    packetProcessor.constructCommandPacket.mockReturnValue([0x01]);

    automationManager = new AutomationManager(config, packetProcessor as any, commandManager as any, mqttPublisher as any);
    automationManager.start();

    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(packetProcessor.constructCommandPacket).toHaveBeenCalled();
    expect(commandManager.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'light_1', type: 'light' }), [0x01]);
  });
});
