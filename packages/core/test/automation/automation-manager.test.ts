import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AutomationManager } from '../../src/automation/automation-manager.js';
import { StateManager } from '../../src/state/state-manager.js';
import { eventBus } from '../../src/service/event-bus.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';
import { logger } from '../../src/utils/logger.js';
import { LightDevice } from '../../src/protocol/devices/light.device.js';
import { ClimateDevice } from '../../src/protocol/devices/climate.device.js';
import { FanDevice } from '../../src/protocol/devices/fan.device.js';

const serial = {
  portId: 'main',
  baud_rate: 9600,
  data_bits: 8,
  parity: 'none',
  stop_bits: 1,
} as any;
const baseConfig: HomenetBridgeConfig = {
  serial,
  light: [{ id: 'light_1', name: 'Light 1', type: 'light', state: { data: [0x01] } }],
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
      { priority: 'normal' },
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
          trigger: [{ type: 'schedule', every: 100 }],
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
    packetProcessor.emit('packet', Buffer.from([0xaa, 0xbb, 0xcc]));
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

    // 일치하지 않는 패킷 수신 (동작하지 않아야 함)
    packetProcessor.emit('packet', Buffer.from([0xaa, 0x00, 0xcc]));
    await vi.runAllTimersAsync();
    expect(mqttPublisher.publish).toHaveBeenCalledTimes(1); // 호출 횟수 증가 없음
  });

  it('update_state 액션이 패킷에서 상태를 추출해 엔티티 상태를 갱신해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      light: [
        {
          id: 'light_1',
          name: 'Light 1',
          type: 'light',
          state: { data: [0x01] },
          state_on: { offset: 3, data: [0x01] },
          state_off: { offset: 3, data: [0x00] },
          state_brightness: { offset: 5, length: 1, decode: 'bcd' },
        },
      ],
      automation: [
        {
          id: 'update_state_test',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xf7, 0x10, 0x01], offset: 0 },
            },
          ],
          then: [
            {
              action: 'update_state',
              target_id: 'light_1',
              state: {
                state_on: { offset: 3, data: [0x01] },
                state_off: { offset: 3, data: [0x00] },
                brightness: { offset: 5, length: 1, decode: 'bcd' },
              },
            },
          ],
        },
      ],
    };
    const mqttPublisherStub = { publish: vi.fn() };
    const stateChangedSpy = vi.fn();
    eventBus.on('state:changed', stateChangedSpy);
    const stateManager = new StateManager(
      'main',
      config,
      packetProcessor as any,
      mqttPublisherStub as any,
      'homenet2mqtt',
    );

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
      undefined,
      undefined,
      stateManager as any,
    );
    automationManager.start();

    packetProcessor.emit('packet', Buffer.from([0xf7, 0x10, 0x01, 0x01, 0x00, 0x89]));
    await vi.runAllTimersAsync();

    expect(stateManager.getEntityState('light_1')).toEqual({
      state: 'ON',
      brightness: 89,
    });
    const firstPublish = mqttPublisherStub.publish.mock.calls.find(
      (call) => call[0] === 'homenet2mqtt/light_1/state',
    );
    expect(firstPublish?.[2]).toEqual({ retain: true });
    expect(JSON.parse(firstPublish?.[1] ?? '{}')).toEqual({
      state: 'ON',
      brightness: 89,
    });
    expect(stateChangedSpy).toHaveBeenCalled();

    packetProcessor.emit('packet', Buffer.from([0xf7, 0x10, 0x01, 0x00, 0x00, 0x00]));
    await vi.runAllTimersAsync();

    expect(stateManager.getEntityState('light_1')).toEqual({
      state: 'OFF',
      brightness: 0,
    });
    const secondPublish = mqttPublisherStub.publish.mock.calls
      .filter((call) => call[0] === 'homenet2mqtt/light_1/state')
      .at(-1);
    expect(secondPublish?.[2]).toEqual({ retain: true });
    expect(JSON.parse(secondPublish?.[1] ?? '{}')).toEqual({
      state: 'OFF',
      brightness: 0,
    });
  });

  it('update_state가 rx_header를 포함한 전체 패킷 기준으로 offset을 계산해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      packet_defaults: {
        rx_header: [0x02],
      },
      light: [
        {
          id: 'light_1',
          name: 'Light 1',
          type: 'light',
          state: { data: [0x01] },
          state_on: { offset: 2, data: [0x01] },
          state_off: { offset: 2, data: [0x00] },
        },
      ],
      automation: [
        {
          id: 'update_state_with_header',
          trigger: [
            {
              type: 'packet',
              match: { data: [0x02, 0x10], offset: 0 },
            },
          ],
          then: [
            {
              action: 'update_state',
              target_id: 'light_1',
              state: {
                state_on: { offset: 2, data: [0x01] },
                state_off: { offset: 2, data: [0x00] },
              },
            },
          ],
        },
      ],
    };
    const mqttPublisherStub = { publish: vi.fn() };
    const stateManager = new StateManager(
      'main',
      config,
      packetProcessor as any,
      mqttPublisherStub as any,
      'homenet2mqtt',
    );

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
      undefined,
      undefined,
      stateManager as any,
    );
    automationManager.start();

    packetProcessor.emit('packet', Buffer.from([0x02, 0x10, 0x01]));
    await vi.runAllTimersAsync();

    expect(stateManager.getEntityState('light_1')).toEqual({
      state: 'ON',
    });
  });

  it('update_state에서 정의되지 않은 속성을 업데이트하려 하면 오류를 반환해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'update_state_invalid_key',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xf7, 0x10, 0x01], offset: 0 },
            },
          ],
          then: [
            {
              action: 'update_state',
              target_id: 'light_1',
              state: {
                invalid_prop: { offset: 3, data: [0x01] },
              },
            },
          ],
        },
      ],
    };
    const mqttPublisherStub = { publish: vi.fn() };
    const stateManager = new StateManager(
      'main',
      config,
      packetProcessor as any,
      mqttPublisherStub as any,
      'homenet2mqtt',
    );
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger as any);

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
      undefined,
      undefined,
      stateManager as any,
    );
    automationManager.start();

    packetProcessor.emit('packet', Buffer.from([0xf7, 0x10, 0x01, 0x01, 0x00, 0x00]));
    await vi.runAllTimersAsync();

    const errorCall = errorSpy.mock.calls.find((call) => call[1] === '[automation] Action failed');
    expect(errorCall?.[0]?.error?.message).toContain('update_state');
    expect(stateManager.getEntityState('light_1')).toBeUndefined();

    errorSpy.mockRestore();
  });

  it('update_state가 팬 속도를 갱신하면 speed 속성이 업데이트되어야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      fan: [
        {
          id: 'fan_1',
          name: 'Fan 1',
          type: 'fan',
          state: { data: [0x02] },
          state_speed: { offset: 3, length: 1 },
        },
      ],
      automation: [
        {
          id: 'update_state_fan_speed',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xf7, 0x20, 0x02], offset: 0 },
            },
          ],
          then: [
            {
              action: 'update_state',
              target_id: 'fan_1',
              state: {
                state_speed: { offset: 3, length: 1 },
              },
            },
          ],
        },
      ],
    };
    const mqttPublisherStub = { publish: vi.fn() };
    const stateManager = new StateManager(
      'main',
      config,
      packetProcessor as any,
      mqttPublisherStub as any,
      'homenet2mqtt',
    );

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
      undefined,
      undefined,
      stateManager as any,
    );
    automationManager.start();

    packetProcessor.emit('packet', Buffer.from([0xf7, 0x20, 0x02, 0x03]));
    await vi.runAllTimersAsync();

    expect(stateManager.getEntityState('fan_1')).toEqual({
      speed: 3,
    });
    const publishCall = mqttPublisherStub.publish.mock.calls.find(
      (call) => call[0] === 'homenet2mqtt/fan_1/state',
    );
    expect(publishCall?.[2]).toEqual({ retain: true });
    expect(JSON.parse(publishCall?.[1] ?? '{}')).toEqual({
      speed: 3,
    });
  });

  it('update_state가 climate target_temperature를 갱신하면 상태가 반영되어야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      climate: [
        {
          id: 'climate_1',
          name: 'Climate 1',
          type: 'climate',
          state: { data: [0x03] },
          state_temperature_target: { offset: 3, length: 1 },
        },
      ],
      automation: [
        {
          id: 'update_state_climate_target',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xf7, 0x30, 0x03], offset: 0 },
            },
          ],
          then: [
            {
              action: 'update_state',
              target_id: 'climate_1',
              state: {
                state_temperature_target: { offset: 3, length: 1 },
              },
            },
          ],
        },
      ],
    };
    const mqttPublisherStub = { publish: vi.fn() };
    const stateManager = new StateManager(
      'main',
      config,
      packetProcessor as any,
      mqttPublisherStub as any,
      'homenet2mqtt',
    );

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
      undefined,
      undefined,
      stateManager as any,
    );
    automationManager.start();

    packetProcessor.emit('packet', Buffer.from([0xf7, 0x30, 0x03, 0x19]));
    await vi.runAllTimersAsync();

    expect(stateManager.getEntityState('climate_1')).toEqual({
      target_temperature: 25,
    });
    const publishCall = mqttPublisherStub.publish.mock.calls.find(
      (call) => call[0] === 'homenet2mqtt/climate_1/state',
    );
    expect(publishCall?.[2]).toEqual({ retain: true });
    expect(JSON.parse(publishCall?.[1] ?? '{}')).toEqual({
      target_temperature: 25,
    });
  });

  it('update_state가 parseData와 동일한 상태 해석을 수행해야 한다', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      light: [
        {
          id: 'light_1',
          name: 'Light 1',
          type: 'light',
          state: { data: [0x01] },
          state_on: { offset: 1, data: [0x01] },
          state_off: { offset: 1, data: [0x00] },
          state_brightness: { offset: 2, length: 1 },
        },
      ],
      climate: [
        {
          id: 'climate_1',
          name: 'Climate 1',
          type: 'climate',
          state: { data: [0x02] },
          state_heat: { offset: 1, data: [0x01] },
          state_action_heating: { offset: 2, data: [0x01] },
          state_fan_low: { offset: 3, data: [0x01] },
          state_preset_eco: { offset: 4, data: [0x01] },
          state_temperature_target: { offset: 5, length: 1 },
        },
      ],
      fan: [
        {
          id: 'fan_1',
          name: 'Fan 1',
          type: 'fan',
          state: { data: [0x03] },
          state_on: { offset: 1, data: [0x01] },
          state_speed: { offset: 2, length: 1 },
          state_oscillating: { offset: 3, data: [0x01] },
          state_direction: { offset: 4, data: [0x01] },
        },
      ],
      automation: [
        {
          id: 'update_state_light_parse',
          trigger: [{ type: 'packet', match: { data: [0x01, 0x01], offset: 0 } }],
          then: [
            {
              action: 'update_state',
              target_id: 'light_1',
              state: {
                state_on: { offset: 1, data: [0x01] },
                state_off: { offset: 1, data: [0x00] },
                state_brightness: { offset: 2, length: 1 },
              },
            },
          ],
        },
        {
          id: 'update_state_climate_parse',
          trigger: [{ type: 'packet', match: { data: [0x02, 0x01], offset: 0 } }],
          then: [
            {
              action: 'update_state',
              target_id: 'climate_1',
              state: {
                state_heat: { offset: 1, data: [0x01] },
                state_action_heating: { offset: 2, data: [0x01] },
                state_fan_low: { offset: 3, data: [0x01] },
                state_preset_eco: { offset: 4, data: [0x01] },
                state_temperature_target: { offset: 5, length: 1 },
              },
            },
          ],
        },
        {
          id: 'update_state_fan_parse',
          trigger: [{ type: 'packet', match: { data: [0x03, 0x01], offset: 0 } }],
          then: [
            {
              action: 'update_state',
              target_id: 'fan_1',
              state: {
                state_on: { offset: 1, data: [0x01] },
                state_speed: { offset: 2, length: 1 },
                state_oscillating: { offset: 3, data: [0x01] },
                state_direction: { offset: 4, data: [0x01] },
              },
            },
          ],
        },
      ],
    };
    const mqttPublisherStub = { publish: vi.fn() };
    const stateManager = new StateManager(
      'main',
      config,
      packetProcessor as any,
      mqttPublisherStub as any,
      'homenet2mqtt',
    );

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
      undefined,
      undefined,
      stateManager as any,
    );
    automationManager.start();

    const protocolConfig = { packet_defaults: config.packet_defaults } as any;
    const lightDevice = new LightDevice(config.light?.[0] as any, protocolConfig);
    const climateDevice = new ClimateDevice(config.climate?.[0] as any, protocolConfig);
    const fanDevice = new FanDevice(config.fan?.[0] as any, protocolConfig);

    const lightPacket = Buffer.from([0x01, 0x01, 0x64]);
    const lightExpected = lightDevice.parseData(lightPacket);
    packetProcessor.emit('packet', lightPacket);
    await vi.runAllTimersAsync();
    expect(stateManager.getEntityState('light_1')).toEqual(lightExpected);

    const climatePacket = Buffer.from([0x02, 0x01, 0x01, 0x01, 0x01, 0x19]);
    const climateExpected = climateDevice.parseData(climatePacket);
    packetProcessor.emit('packet', climatePacket);
    await vi.runAllTimersAsync();
    expect(stateManager.getEntityState('climate_1')).toEqual(climateExpected);

    const fanPacket = Buffer.from([0x03, 0x01, 0x05, 0x01, 0x01]);
    const fanExpected = fanDevice.parseData(fanPacket);
    packetProcessor.emit('packet', fanPacket);
    await vi.runAllTimersAsync();
    expect(stateManager.getEntityState('fan_1')).toEqual(fanExpected);
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

  it('should use command schema priority if automation priority is undefined', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      light: [
        {
          id: 'light_1',
          name: 'Light 1',
          type: 'light',
          state: { data: [0x01] },
          command_on: { data: [0x01], low_priority: true },
        },
      ],
      automation: [
        {
          id: 'schema_priority_test',
          trigger: [{ type: 'startup' }],
          then: [
            {
              action: 'command',
              target: 'id(light_1).command_on()',
              // low_priority is undefined here
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

    await vi.runAllTimersAsync();

    expect(commandManager.send).toHaveBeenCalledWith(expect.anything(), [0x01], {
      priority: 'low',
    });
  });

  it('should override command schema priority with automation priority', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      light: [
        {
          id: 'light_1',
          name: 'Light 1',
          type: 'light',
          state: { data: [0x01] },
          command_on: { data: [0x01], low_priority: true },
        },
      ],
      automation: [
        {
          id: 'override_priority_test',
          trigger: [{ type: 'startup' }],
          then: [
            {
              action: 'command',
              target: 'id(light_1).command_on()',
              low_priority: false, // Override to normal
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

    await vi.runAllTimersAsync();

    expect(commandManager.send).toHaveBeenCalledWith(expect.anything(), [0x01], {
      priority: 'normal',
    });
  });

  it('should handle send_packet action with new ACK format (array)', async () => {
    const config: HomenetBridgeConfig = {
      ...baseConfig,
      automation: [
        {
          id: 'send_packet_ack_test',
          trigger: [{ type: 'startup' }],
          then: [
            {
              action: 'send_packet',
              data: [0x01, 0x02],
              ack: [0x06], // New simple format
            },
          ],
        },
      ],
    };

    const mockSender = vi.fn().mockResolvedValue(undefined);

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
      undefined,
      mockSender, // inject mock sender
    );
    automationManager.start();

    await vi.runAllTimersAsync();

    expect(mockSender).toHaveBeenCalledWith(
      undefined, // portId
      expect.arrayContaining([0x01, 0x02]), // data (might have checksum appended depending on defaults, but here defaults are empty/undefined so likely just data)
      expect.objectContaining({
        ackMatch: { data: [0x06] }, // array is converted to StateSchema
      }),
    );
  });

  describe('Automation Mode', () => {
    it('parallel 모드(기본)에서는 여러 실행이 병렬로 진행되어야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        automation: [
          {
            id: 'parallel_test',
            // mode는 기본값 (parallel)
            trigger: [
              {
                type: 'packet',
                match: { data: [0xaa], offset: 0 },
              },
            ],
            then: [
              { action: 'publish', topic: 'start', payload: 'begin' },
              { action: 'delay', milliseconds: 100 },
              { action: 'publish', topic: 'end', payload: 'done' },
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

      // 첫 번째 트리거
      packetProcessor.emit('packet', Buffer.from([0xaa]));
      await vi.advanceTimersByTimeAsync(10);
      expect(mqttPublisher.publish).toHaveBeenCalledWith('start', 'begin', undefined);

      // 두 번째 트리거 (첫 번째가 딜레이 중일 때)
      packetProcessor.emit('packet', Buffer.from([0xaa]));
      await vi.advanceTimersByTimeAsync(10);
      // 두 번 'start'가 호출되어야 함 (병렬)
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(2);

      // 딜레이 완료
      await vi.advanceTimersByTimeAsync(100);
      // 두 번 'end'가 호출되어야 함
      expect(mqttPublisher.publish).toHaveBeenCalledWith('end', 'done', undefined);
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(4);
    });

    it('single 모드에서는 이미 실행 중이면 새 트리거가 무시되어야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        automation: [
          {
            id: 'single_test',
            mode: 'single',
            trigger: [
              {
                type: 'packet',
                match: { data: [0xaa], offset: 0 },
              },
            ],
            then: [
              { action: 'publish', topic: 'start', payload: 'begin' },
              { action: 'delay', milliseconds: 100 },
              { action: 'publish', topic: 'end', payload: 'done' },
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

      // 첫 번째 트리거
      packetProcessor.emit('packet', Buffer.from([0xaa]));
      await vi.advanceTimersByTimeAsync(10);
      expect(mqttPublisher.publish).toHaveBeenCalledWith('start', 'begin', undefined);
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

      // 두 번째 트리거 (첫 번째가 딜레이 중일 때) -> 무시되어야 함
      packetProcessor.emit('packet', Buffer.from([0xaa]));
      await vi.advanceTimersByTimeAsync(10);
      // 여전히 1번만 호출되어야 함 (single 모드)
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

      // 딜레이 완료
      await vi.advanceTimersByTimeAsync(100);
      expect(mqttPublisher.publish).toHaveBeenCalledWith('end', 'done', undefined);
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(2);
    });

    it('restart 모드에서는 이전 실행이 취소되고 새로 시작되어야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        automation: [
          {
            id: 'restart_test',
            mode: 'restart',
            trigger: [
              {
                type: 'packet',
                match: { data: [0xaa], offset: 0 },
              },
            ],
            then: [
              { action: 'publish', topic: 'start', payload: 'begin' },
              { action: 'delay', milliseconds: 100 },
              { action: 'publish', topic: 'end', payload: 'done' },
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

      // 첫 번째 트리거
      packetProcessor.emit('packet', Buffer.from([0xaa]));
      await vi.advanceTimersByTimeAsync(10);
      expect(mqttPublisher.publish).toHaveBeenCalledWith('start', 'begin', undefined);
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

      // 50ms 후 두 번째 트리거 (첫 번째 취소, 새로 시작)
      await vi.advanceTimersByTimeAsync(40);
      packetProcessor.emit('packet', Buffer.from([0xaa]));
      await vi.advanceTimersByTimeAsync(10);
      // 두 번째 'start' 호출
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(2);

      // 100ms 더 기다림 (두 번째 딜레이 완료)
      await vi.advanceTimersByTimeAsync(100);
      // 첫 번째는 취소되어 'end'가 한 번만 호출되어야 함
      expect(mqttPublisher.publish).toHaveBeenCalledWith('end', 'done', undefined);
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(3);
    });

    it('queued 모드에서는 자동화가 순차적으로 실행되어야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        automation: [
          {
            id: 'queued_test',
            mode: 'queued',
            trigger: [
              {
                type: 'packet',
                match: { data: [0xaa], offset: 0 },
              },
            ],
            then: [
              { action: 'publish', topic: 'run', payload: 'start' },
              { action: 'delay', milliseconds: 50 },
              { action: 'publish', topic: 'run', payload: 'end' },
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

      // 첫 번째 트리거
      packetProcessor.emit('packet', Buffer.from([0xaa]));
      await vi.advanceTimersByTimeAsync(1);
      expect(mqttPublisher.publish).toHaveBeenCalledWith('run', 'start', undefined);
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

      // 두 번째 트리거 (큐에 추가됨)
      packetProcessor.emit('packet', Buffer.from([0xaa]));
      await vi.advanceTimersByTimeAsync(1);
      // 아직 첫 번째 실행 중이므로 'start' 한 번만 호출
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(1);

      // 첫 번째 딜레이 완료 (50ms) - 두 번째도 바로 시작됨
      await vi.advanceTimersByTimeAsync(60);
      // 첫 번째 'end' + 두 번째 'start' = 3회
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(3);

      // 두 번째 딜레이 완료
      await vi.advanceTimersByTimeAsync(60);
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(4); // 두 번째 'end'
    });
  });

  describe('If Action', () => {
    it('조건이 참이면 then 블록을 실행해야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        sensor: [{ id: 'sensor_temp', name: 'Temp', type: 'sensor', state: { data: [0x01] } }],
        automation: [
          {
            id: 'if_then_test',
            trigger: [
              {
                type: 'packet',
                match: { data: [0xaa], offset: 0 },
              },
            ],
            then: [
              {
                action: 'if',
                condition: "states['sensor_temp']['value'] > 20",
                then: [{ action: 'publish', topic: 'if', payload: 'then' }],
                else: [{ action: 'publish', topic: 'if', payload: 'else' }],
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

      // 상태 설정 후 패킷 트리거
      eventBus.emit('state:changed', { entityId: 'sensor_temp', state: { value: 25 } });
      packetProcessor.emit('packet', Buffer.from([0xaa]));

      await vi.runAllTimersAsync();
      expect(mqttPublisher.publish).toHaveBeenCalledWith('if', 'then', undefined);
    });

    it('조건이 거짓이면 else 블록을 실행해야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        sensor: [{ id: 'sensor_temp', name: 'Temp', type: 'sensor', state: { data: [0x01] } }],
        automation: [
          {
            id: 'if_else_test',
            trigger: [
              {
                type: 'packet',
                match: { data: [0xaa], offset: 0 },
              },
            ],
            then: [
              {
                action: 'if',
                condition: "states['sensor_temp']['value'] > 20",
                then: [{ action: 'publish', topic: 'if', payload: 'then' }],
                else: [{ action: 'publish', topic: 'if', payload: 'else' }],
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

      // 상태 설정 (조건 false) 후 패킷 트리거
      eventBus.emit('state:changed', { entityId: 'sensor_temp', state: { value: 15 } });
      packetProcessor.emit('packet', Buffer.from([0xaa]));

      await vi.runAllTimersAsync();
      expect(mqttPublisher.publish).toHaveBeenCalledWith('if', 'else', undefined);
    });

    it('else 블록이 없고 조건이 거짓이면 아무것도 실행하지 않아야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        sensor: [{ id: 'sensor_temp', name: 'Temp', type: 'sensor', state: { data: [0x01] } }],
        automation: [
          {
            id: 'if_no_else_test',
            trigger: [
              {
                type: 'packet',
                match: { data: [0xaa], offset: 0 },
              },
            ],
            then: [
              {
                action: 'if',
                condition: "states['sensor_temp']['value'] > 20",
                then: [{ action: 'publish', topic: 'if', payload: 'then' }],
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

      eventBus.emit('state:changed', { entityId: 'sensor_temp', state: { value: 15 } });
      packetProcessor.emit('packet', Buffer.from([0xaa]));

      await vi.runAllTimersAsync();
      expect(mqttPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('Repeat Action', () => {
    it('count 횟수만큼 반복 실행해야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        automation: [
          {
            id: 'repeat_count_test',
            trigger: [{ type: 'startup' }],
            then: [
              {
                action: 'repeat',
                count: 3,
                actions: [{ action: 'publish', topic: 'repeat', payload: 'tick' }],
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

      await vi.runAllTimersAsync();
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(3);
    });

    it('while 조건이 거짓이 되면 반복을 중단해야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        sensor: [{ id: 'counter', name: 'Counter', type: 'sensor', state: { data: [0x01] } }],
        automation: [
          {
            id: 'repeat_while_test',
            trigger: [
              {
                type: 'packet',
                match: { data: [0xaa], offset: 0 },
              },
            ],
            then: [
              {
                action: 'repeat',
                while: "states['counter']['value'] < 3",
                max: 10,
                actions: [{ action: 'publish', topic: 'repeat', payload: 'tick' }],
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

      // 초기 카운터 설정
      eventBus.emit('state:changed', { entityId: 'counter', state: { value: 0 } });

      // 카운터 증가 시뮬레이션
      let counter = 0;
      mqttPublisher.publish.mockImplementation(() => {
        counter++;
        eventBus.emit('state:changed', { entityId: 'counter', state: { value: counter } });
      });

      packetProcessor.emit('packet', Buffer.from([0xaa]));

      await vi.runAllTimersAsync();
      // 0, 1, 2 세 번 실행 후 condition이 false가 되어 중단
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(3);
    });

    it('max 제한에 도달하면 반복을 중단해야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        automation: [
          {
            id: 'repeat_max_test',
            trigger: [{ type: 'startup' }],
            then: [
              {
                action: 'repeat',
                while: 'true', // 항상 참
                max: 5,
                actions: [{ action: 'publish', topic: 'repeat', payload: 'tick' }],
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

      await vi.runAllTimersAsync();
      // max 5로 제한됨
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(5);
    });

    it('중첩된 if와 repeat 액션이 올바르게 동작해야 한다', async () => {
      const config: HomenetBridgeConfig = {
        ...baseConfig,
        sensor: [{ id: 'switch_1', name: 'Switch', type: 'sensor', state: { data: [0x01] } }],
        automation: [
          {
            id: 'nested_test',
            trigger: [
              {
                type: 'packet',
                match: { data: [0xaa], offset: 0 },
              },
            ],
            then: [
              {
                action: 'if',
                condition: "states['switch_1']['power'] == 'on'",
                then: [
                  {
                    action: 'repeat',
                    count: 2,
                    actions: [{ action: 'publish', topic: 'nested', payload: 'ok' }],
                  },
                ],
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

      eventBus.emit('state:changed', { entityId: 'switch_1', state: { power: 'on' } });
      packetProcessor.emit('packet', Buffer.from([0xaa]));

      await vi.runAllTimersAsync();
      expect(mqttPublisher.publish).toHaveBeenCalledTimes(2);
      expect(mqttPublisher.publish).toHaveBeenCalledWith('nested', 'ok', undefined);
    });
  });
});
