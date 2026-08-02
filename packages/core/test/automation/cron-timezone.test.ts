import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'events';
import { AutomationManager } from '../../src/automation/automation-manager.js';
import type { PacketProcessor } from '../../src/protocol/packet-processor.js';
import type { CommandManager } from '../../src/service/command.manager.js';
import type { StatePublisher } from '../../src/state/state-manager.js';
import { eventBus } from '../../src/service/event-bus.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';

describe('AutomationManager (Cron Local Time)', () => {
  let automationManager: AutomationManager;
  let packetProcessor: PacketProcessor & EventEmitter;
  let commandManager: CommandManager;
  let mqttPublisher: {
    publish: Mock<Parameters<StatePublisher['publish']>, ReturnType<StatePublisher['publish']>>;
  };

  const baseConfig: HomenetBridgeConfig = {
    serial: { portId: 'main' } as any,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    packetProcessor = new EventEmitter() as unknown as PacketProcessor & EventEmitter;
    commandManager = { send: vi.fn(), sendRaw: vi.fn() } as unknown as CommandManager;
    mqttPublisher = { publish: vi.fn() };
  });

  afterEach(() => {
    automationManager?.stop();
    eventBus.removeAllListeners();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('cron 트리거가 로컬 시간을 기준으로 동작해야 한다', async () => {
    // 현재 시스템의 로컬 시간대 기준으로 10시 0분을 가리키는 Date 객체 생성
    // vi.setSystemTime은 UTC 타임스탬프를 설정하지만, new Date()는 이를 시스템 로컬 타임존으로 해석함.
    // 따라서 로컬 10시로 설정하려면:
    // 1. 현재 날짜의 로컬 10시를 구함
    const now = new Date();
    now.setHours(10, 0, 0, 0); // 로컬 10:00:00

    // 2. 테스트 시작 시간을 로컬 9:59:59로 설정
    const startTime = new Date(now.getTime() - 1000);
    vi.setSystemTime(startTime);

    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'cron_local_test',
          trigger: [
            {
              type: 'schedule',
              cron: '0 10 * * *', // 매일 10시 0분 (로컬 기준)
            },
          ],
          then: [{ action: 'publish', topic: 'cron', payload: 'fired' }],
        },
      ],
    };

    automationManager = new AutomationManager({
      config,
      packetProcessor,
      commandManager,
      mqttPublisher,
    });
    automationManager.start();

    // 1초 진행 -> 10:00:00 (로컬) 도달
    await vi.advanceTimersByTimeAsync(1000);

    expect(mqttPublisher.publish).toHaveBeenCalledWith('cron', 'fired', undefined);
  });
});
