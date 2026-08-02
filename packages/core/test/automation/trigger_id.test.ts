import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutomationManager } from '../../src/automation/automation-manager.js';
import { eventBus } from '../../src/service/event-bus.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';

describe('Automation Trigger ID', () => {
  let automationManager: AutomationManager | undefined;
  let packetProcessor: EventEmitter;
  let commandManager: any;
  let mqttPublisher: { publish: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    packetProcessor = new EventEmitter();
    commandManager = { send: vi.fn().mockResolvedValue(undefined) };
    mqttPublisher = { publish: vi.fn() };
  });

  afterEach(() => {
    automationManager?.stop();
    eventBus.removeAllListeners();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('packet 트리거의 id를 사용하여 분기 처리할 수 있어야 한다', async () => {
    const config: HomenetBridgeConfig = {
      serial: { portId: 'main' } as any,
      automation: [
        {
          id: 'packet_trigger_id_test',
          trigger: [
            {
              id: 'trigger_a',
              type: 'packet',
              match: { data: [0x30, 0x01], index: 0 },
            },
            {
              id: 'trigger_b',
              type: 'packet',
              match: { data: [0x30, 0x02], index: 0 },
            },
          ],
          then: [
            {
              action: 'publish',
              topic: 'test/trigger_id',
              payload: "trigger.id == 'trigger_a' ? 'A' : 'B'",
            },
          ],
        },
      ],
    };

    automationManager = new AutomationManager({
      config: config,
      packetProcessor: packetProcessor as any,
      commandManager: commandManager,
      mqttPublisher: mqttPublisher as any,
    });
    automationManager.start();

    // trigger_a에 매칭되는 패킷 전송
    packetProcessor.emit('packet', Buffer.from([0x30, 0x01]));
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledWith('test/trigger_id', 'A', undefined);

    // trigger_b에 매칭되는 패킷 전송
    packetProcessor.emit('packet', Buffer.from([0x30, 0x02]));
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledWith('test/trigger_id', 'B', undefined);
  });

  it('state 트리거의 id를 사용하여 분기 처리할 수 있어야 한다', async () => {
    const config: HomenetBridgeConfig = {
      serial: { portId: 'main' } as any,
      automation: [
        {
          id: 'state_trigger_id_test',
          trigger: [
            {
              id: 'state_on_trigger',
              type: 'state',
              entity_id: 'light_1',
              property: 'state_on',
              match: true,
            },
            {
              id: 'state_off_trigger',
              type: 'state',
              entity_id: 'light_1',
              property: 'state_on',
              match: false,
            },
          ],
          then: [
            {
              action: 'publish',
              topic: 'test/state_trigger_id',
              payload: "trigger.id == 'state_on_trigger' ? 'ON' : 'OFF'",
            },
          ],
        },
      ],
    };

    automationManager = new AutomationManager({
      config: config,
      packetProcessor: packetProcessor as any,
      commandManager: commandManager,
      mqttPublisher: mqttPublisher as any,
    });
    automationManager.start();

    // state:changed 이벤트 발생 (ON)
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledWith('test/state_trigger_id', 'ON', undefined);

    // state:changed 이벤트 발생 (OFF)
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: false } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledWith('test/state_trigger_id', 'OFF', undefined);
  });
});
