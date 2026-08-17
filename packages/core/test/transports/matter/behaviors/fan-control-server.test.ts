import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FanControl } from '@matter/main/clusters';
import { FanControlServer } from '../../../../src/transports/matter/behaviors/fan-control-server.js';
import { HomenetEntityBehavior } from '../../../../src/transports/matter/behaviors/homenet-entity-behavior.js';

vi.mock('../../../../src/transports/matter/behaviors/homenet-entity-behavior.js', () => ({
  HomenetEntityBehavior: class {
    static id = 'homenetEntity';
  },
}));

vi.mock('../../../../src/transports/matter/utils/apply-patch-state.js', () => ({
  applyPatchState: vi.fn((state, patch) => {
    Object.assign(state, patch);
  }),
}));

describe('FanControlServer', () => {
  let server: any;
  let mockHomenet: any;
  let reactToFn: any;
  let state: any;

  beforeEach(() => {
    vi.clearAllMocks();

    state = {};
    reactToFn = vi.fn();
    mockHomenet = {
      entityConfig: {
        id: 'room_1_ventilation',
        speed_range_min: 1,
        speed_range_max: 3,
        command_speed: [],
      },
      entityState: { state: 'ON', speed: 2 },
      onChange: {},
      entityId: 'room_1_ventilation',
      executeCommand: vi.fn().mockResolvedValue({ success: true }),
    };

    const AgentMock = class {
      async load(Behavior: any) {
        if (Behavior === HomenetEntityBehavior) return mockHomenet;
        return null;
      }
      get(Behavior: any) {
        if (Behavior === HomenetEntityBehavior) return mockHomenet;
        return null;
      }
    };
    const agent = new AgentMock();

    server = Object.create(FanControlServer.prototype);
    Object.defineProperty(server, 'state', { get: () => state });
    Object.defineProperty(server, 'agent', { get: () => agent });
    Object.defineProperty(server, 'events', {
      get: () => ({ speedSetting$Changed: { name: 'speedSetting$Changed' } }),
    });
    server.reactTo = reactToFn;

    const origInit = server.initialize;
    server.initialize = async function () {
      const baseProto = Object.getPrototypeOf(Object.getPrototypeOf(this));
      const oldInit = baseProto.initialize;
      baseProto.initialize = async () => {};
      try {
        await origInit.call(this);
      } finally {
        baseProto.initialize = oldInit;
      }
    };
  });

  it('Homenet 상태 변경과 Matter 목표 풍량 변경을 모두 offline reactor로 등록한다', async () => {
    await server.initialize();

    expect(reactToFn).toHaveBeenCalledWith(mockHomenet.onChange, expect.any(Function), {
      offline: true,
    });
    expect(reactToFn).toHaveBeenCalledWith({ name: 'speedSetting$Changed' }, expect.any(Function), {
      offline: true,
    });
  });

  it('기존 MQTT fan 속도 범위 1~3 설정을 Matter FanControl 상태로 매핑한다', async () => {
    await server.initialize();

    expect(state.speedMax).toBe(3);
    expect(state.speedSetting).toBe(2);
    expect(state.speedCurrent).toBe(2);
    expect(state.fanMode).toBe(FanControl.FanMode.On);
    expect(state.fanModeSequence).toBe(FanControl.FanModeSequence.OffLowMedHigh);
  });

  it('Matter 목표 풍량 변경 시 command_speed 명령을 실행하고 만료될 수 있는 Homenet state를 재참조하지 않는다', async () => {
    await server.initialize();
    mockHomenet.executeCommand.mockImplementationOnce(async () => {
      Object.defineProperty(mockHomenet, 'entityState', {
        get: () => {
          throw new Error('ExpiredReferenceError');
        },
      });
      return { success: true };
    });

    await server.targetSpeedSettingChanged(3);

    expect(mockHomenet.executeCommand).toHaveBeenCalledWith('room_1_ventilation', 'speed', 3);
    expect(state.speedSetting).toBe(3);
    expect(state.speedCurrent).toBe(3);
    expect(state.fanMode).toBe(FanControl.FanMode.On);
  });

  it('Matter step 명령을 다음 풍량으로 변환한다', async () => {
    await server.initialize();

    await server.step({ direction: FanControl.StepDirection.Increase });

    expect(mockHomenet.executeCommand).toHaveBeenCalledWith('room_1_ventilation', 'speed', 3);
    expect(state.speedSetting).toBe(3);
  });

  it('Matter step 명령에서 lowestOff와 wrap을 지원한다', async () => {
    mockHomenet.entityState = { state: 'OFF', speed: 0 };
    await server.initialize();

    await server.step({
      direction: FanControl.StepDirection.Decrease,
      lowestOff: true,
      wrap: true,
    });

    expect(mockHomenet.executeCommand).toHaveBeenCalledWith('room_1_ventilation', 'speed', 3);
    expect(state.speedSetting).toBe(3);
  });

  it('Matter 목표 풍량 0은 fan off 명령으로 변환한다', async () => {
    await server.initialize();

    await server.targetSpeedSettingChanged(0);

    expect(mockHomenet.executeCommand).toHaveBeenCalledWith('room_1_ventilation', 'off');
    expect(state.speedSetting).toBe(0);
    expect(state.speedCurrent).toBe(0);
    expect(state.fanMode).toBe(FanControl.FanMode.Off);
  });
});
