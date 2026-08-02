import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

import { AutomationManager } from '../../src/automation/automation-manager.js';
import type { PacketProcessor } from '../../src/protocol/packet-processor.js';
import type { CommandManager } from '../../src/service/command.manager.js';
import { StateManager, type StatePublisher } from '../../src/state/state-manager.js';
import { eventBus } from '../../src/service/event-bus.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';
import { normalizeConfig } from '../../src/config/index.js';

describe('Automation Field Aliases', () => {
  let automationManager: AutomationManager | undefined;
  let packetProcessor: PacketProcessor & EventEmitter & { constructCommandPacket: Mock };
  let commandManager: CommandManager & { send: Mock };
  let mqttPublisher: {
    publish: Mock<Parameters<StatePublisher['publish']>, ReturnType<StatePublisher['publish']>>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    packetProcessor = Object.assign(new EventEmitter(), {
      constructCommandPacket: vi.fn(),
    }) as unknown as PacketProcessor & EventEmitter & { constructCommandPacket: Mock };
    commandManager = { send: vi.fn().mockResolvedValue(undefined) } as unknown as CommandManager & {
      send: Mock;
    };
    mqttPublisher = { publish: vi.fn() };
  });

  afterEach(() => {
    automationManager?.stop();
    eventBus.removeAllListeners();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('state trigger의 debounce alias가 debounce_ms로 정상 변환되어야 한다', async () => {
    const config: HomenetBridgeConfig = normalizeConfig({
      serial: { portId: 'main' } as any,
      automation: [
        {
          id: 'debounce_alias_test',
          trigger: [
            {
              type: 'state',
              entity_id: 'light_1',
              property: 'state_on',
              match: true,
              debounce: 100, // alias
            },
          ],
          then: [{ action: 'publish', topic: 'test', payload: 'hit' }],
        },
      ],
    } as any);

    automationManager = new AutomationManager({
      config,
      packetProcessor,
      commandManager,
      mqttPublisher,
    });
    automationManager.start();

    // 첫 번째 트리거
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

    // 디바운스 기간 내 재발생 (무시)
    vi.advanceTimersByTime(50);
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

    // 디바운스 기간 이후 발생
    vi.advanceTimersByTime(60);
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(2);
  });

  it('delay action의 duration alias가 milliseconds로 정상 변환되어야 한다', async () => {
    const config: HomenetBridgeConfig = normalizeConfig({
      serial: { portId: 'main' } as any,
      automation: [
        {
          id: 'delay_duration_test',
          trigger: [{ type: 'startup' }],
          then: [
            { action: 'publish', topic: 'start', payload: '1' },
            { action: 'delay', duration: 100 }, // alias
            { action: 'publish', topic: 'end', payload: '2' },
          ],
        },
      ],
    } as any);

    automationManager = new AutomationManager({
      config,
      packetProcessor,
      commandManager,
      mqttPublisher,
    });
    automationManager.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(mqttPublisher.publish).toHaveBeenCalledWith('start', '1', undefined);
    expect(mqttPublisher.publish).not.toHaveBeenCalledWith('end', '2', undefined);

    await vi.advanceTimersByTimeAsync(100);
    expect(mqttPublisher.publish).toHaveBeenCalledWith('end', '2', undefined);
  });

  it('delay action의 delay alias가 milliseconds로 정상 변환되어야 한다', async () => {
    const config: HomenetBridgeConfig = normalizeConfig({
      serial: { portId: 'main' } as any,
      automation: [
        {
          id: 'delay_delay_test',
          trigger: [{ type: 'startup' }],
          then: [
            { action: 'publish', topic: 'start', payload: '1' },
            { action: 'delay', delay: 200 }, // alias
            { action: 'publish', topic: 'end', payload: '2' },
          ],
        },
      ],
    } as any);

    automationManager = new AutomationManager({
      config,
      packetProcessor,
      commandManager,
      mqttPublisher,
    });
    automationManager.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(mqttPublisher.publish).toHaveBeenCalledWith('start', '1', undefined);

    await vi.advanceTimersByTimeAsync(100);
    expect(mqttPublisher.publish).not.toHaveBeenCalledWith('end', '2', undefined);

    await vi.advanceTimersByTimeAsync(100);
    expect(mqttPublisher.publish).toHaveBeenCalledWith('end', '2', undefined);
  });
});
