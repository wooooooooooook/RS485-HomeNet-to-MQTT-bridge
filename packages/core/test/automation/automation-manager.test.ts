import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AutomationManager } from '../../src/automation/automation-manager.js';
import { eventBus } from '../../src/service/event-bus.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';

const serial = {
  portId: 'main',
  baud_rate: 9600,
  data_bits: 8,
  parity: 'none',
  stop_bits: 1,
} as any;
const baseConfig: HomenetBridgeConfig = {
  serial,
  serials: [serial],
  light: [{ id: 'light_1', name: 'Light 1', type: 'light' }],
};

describe('AutomationManager', () => {
  let automationManager: AutomationManager | undefined;
  let packetProcessor: EventEmitter & { constructCommandPacket: ReturnType<typeof vi.fn> };
  let commandManager: { send: ReturnType<typeof vi.fn> };
  let mqttPublisher: { publish: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    packetProcessor = Object.assign(new EventEmitter(), {
      constructCommandPacket: vi.fn(),
    });
    commandManager = { send: vi.fn().mockResolvedValue(undefined) };
    mqttPublisher = { publish: vi.fn() };
  });

  afterEach(() => {
    automationManager?.stop();
    eventBus.removeAllListeners();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('상태 트리거가 일치할 때 MQTT 메시지를 발행해야 한다', async () => {
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

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    // 상태 변경 이벤트 발생
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();

    expect(mqttPublisher.publish).toHaveBeenCalledWith('automation/test', 'on', undefined);
  });

  it('파싱된 타겟을 사용하여 명령 액션을 실행해야 한다', async () => {
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

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();

    expect(packetProcessor.constructCommandPacket).toHaveBeenCalled();
    expect(commandManager.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'light_1', type: 'light' }),
      [0x01],
    );
  });

  it('시작(startup) 트리거 시 동작해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'startup_test',
          trigger: [{ type: 'startup' }],
          then: [{ action: 'publish', topic: 'startup', payload: 'done' }],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    // setTimeout 0으로 스케줄된 startup 트리거 실행 대기
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledWith('startup', 'done', undefined);
  });

  it('스케줄(interval) 트리거에 따라 반복 동작해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'interval_test',
          trigger: [{ type: 'schedule', every_ms: 100 }],
          then: [{ action: 'publish', topic: 'tick', payload: 'tock' }],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    // 100ms 경과 후 첫 번째 실행 확인
    await vi.advanceTimersByTimeAsync(100);
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

    // 추가 100ms 경과 후 두 번째 실행 확인
    await vi.advanceTimersByTimeAsync(100);
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(2);
  });

  it('패킷 일치(packet match) 트리거 시 동작해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'packet_test',
          trigger: [
            {
              type: 'packet',
              match: {
                data: [0xaa, 0xbb],
                offset: 0,
              },
            },
          ],
          then: [{ action: 'publish', topic: 'packet', payload: 'matched' }],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    // 일치하는 패킷 수신
    packetProcessor.emit('packet', [0xaa, 0xbb, 0xcc]);
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

    // 일치하지 않는 패킷 수신 (동작하지 않아야 함)
    packetProcessor.emit('packet', [0xaa, 0x00, 0xcc]);
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(1); // 호출 횟수 증가 없음
  });

  it('숫자 비교(gt, lt 등)가 포함된 상태 트리거를 처리해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'numeric_test',
          trigger: [
            {
              type: 'state',
              entity_id: 'light_1',
              property: 'brightness',
              match: { gt: 50 },
            },
          ],
          then: [{ action: 'publish', topic: 'bright', payload: 'very' }],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    // 조건 불만족 (10 <= 50)
    eventBus.emit('state:changed', { entityId: 'light_1', state: { brightness: 10 } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).not.toHaveBeenCalled();

    // 조건 만족 (60 > 50)
    eventBus.emit('state:changed', { entityId: 'light_1', state: { brightness: 60 } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledWith('bright', 'very', undefined);
  });

  it('상태 트리거의 디바운스(debounce) 설정을 준수해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'debounce_test',
          trigger: [
            {
              type: 'state',
              entity_id: 'light_1',
              property: 'state_on',
              match: true,
              debounce_ms: 100,
            },
          ],
          then: [{ action: 'publish', topic: 'debounced', payload: 'hit' }],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    // 첫 번째 트리거 발생 (즉시 실행)
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

    // 디바운스 시간 내 재발생 (무시되어야 함)
    vi.advanceTimersByTime(50);
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

    // 디바운스 시간 경과 후 발생 (실행되어야 함)
    vi.advanceTimersByTime(60); // 총 110ms 경과
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(2);
  });

  it('가드(guard) 조건에 따라 then 또는 else 분기를 실행해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'guard_test',
          trigger: [{ type: 'startup' }],
          guard: 'return false', // 항상 거짓
          then: [{ action: 'publish', topic: 'guard', payload: 'then' }],
          else: [{ action: 'publish', topic: 'guard', payload: 'else' }],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    // The guard 'return false' should evaluate to false.
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledWith('guard', 'else', undefined);
  });

  it('자동화를 동적으로 추가 및 제거할 수 있어야 한다', async () => {
    automationManager = new AutomationManager(
      baseConfig,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    // 동적으로 확인 가능한 상태 트리거 자동화 추가
    const dynamicAuto: any = {
      id: 'dynamic_state',
      trigger: [{ type: 'state', entity_id: 'light_1', property: 'state_on', match: true }],
      then: [{ action: 'publish', topic: 'dynamic', payload: 'ok' }],
    };

    automationManager.addAutomation(dynamicAuto);

    // 추가된 자동화 동작 확인
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledWith('dynamic', 'ok', undefined);

    // 자동화 제거
    mqttPublisher.publish.mockClear();
    automationManager.removeAutomation('dynamic_state');

    // 제거된 자동화 동작하지 않음 확인
    eventBus.emit('state:changed', { entityId: 'light_1', state: { state_on: true } });
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).not.toHaveBeenCalled();
  });

  it('지연(delay) 액션을 올바르게 실행해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'delay_test',
          trigger: [{ type: 'startup' }],
          then: [
            { action: 'publish', topic: 'step', payload: '1' },
            { action: 'delay', milliseconds: 100 },
            { action: 'publish', topic: 'step', payload: '2' },
          ],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
    );
    automationManager.start();

    // 첫 번째 액션 실행 확인
    await vi.advanceTimersByTimeAsync(1);
    expect(mqttPublisher.publish).toHaveBeenCalledWith('step', '1', undefined);
    expect(mqttPublisher.publish).not.toHaveBeenCalledWith('step', '2', undefined);

    // 지연 시간 경과 후 두 번째 액션 실행 확인
    await vi.advanceTimersByTimeAsync(100);
    expect(mqttPublisher.publish).toHaveBeenCalledWith('step', '2', undefined);
  });
});
