import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoRestartService } from '../../src/services/auto-restart.service.js';

describe('Bridge Fault Recovery Lifecycle & Isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it('Case 1: Bridge B 장애 시 Bridge B만 개별 재시작되고 Bridge A는 재시작되지 않는다', async () => {
    const bridgeA = {
      stop: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };
    const bridgeB = {
      stop: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };

    const bridges = [
      { portId: 'port_a', bridge: bridgeA },
      { portId: 'port_b', bridge: bridgeB },
    ];

    const recoverBridgeFault = vi.fn(async (fault: { portId?: string }) => {
      const target = bridges.find((b) => b.portId === fault.portId);
      if (!target) return false;
      await target.bridge.stop();
      await target.bridge.start();
      return true;
    });

    const triggerRestart = vi.fn();
    const restartProcess = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const service = new AutoRestartService({
      loadSettings: () => ({ autoRestart: { enabled: true, timeoutMinutes: 5 } }) as any,
      recoverFault: recoverBridgeFault,
      triggerRestart,
      restartProcess,
      logger,
    });

    // Bridge B fault 스케줄
    await service.schedule({
      key: 'serial:port_b',
      portId: 'port_b',
      reason: 'serial error',
    });

    // 5분 후 timeout 도달
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // Bridge B만 stop -> start
    expect(bridgeB.stop).toHaveBeenCalledTimes(1);
    expect(bridgeB.start).toHaveBeenCalledTimes(1);

    // Bridge A는 전혀 호출되지 않음
    expect(bridgeA.stop).not.toHaveBeenCalled();
    expect(bridgeA.start).not.toHaveBeenCalled();

    // 전체 프로세스 재시작은 호출되지 않음
    expect(triggerRestart).not.toHaveBeenCalled();
    expect(restartProcess).not.toHaveBeenCalled();
  });

  it('Case 2: LogRetention auto-save timer와 Bridge fault 복구는 독립적으로 동작한다', async () => {
    let logRetentionSaveCount = 0;
    const logRetentionTimer = setInterval(
      () => {
        logRetentionSaveCount += 1;
      },
      60 * 60 * 1000,
    ); // 1시간 주기 auto-save

    const bridgeB = {
      stop: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };

    const recoverBridgeFault = vi.fn(async () => {
      await bridgeB.stop();
      await bridgeB.start();
      return true;
    });

    const triggerRestart = vi.fn();
    const restartProcess = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const service = new AutoRestartService({
      loadSettings: () => ({ autoRestart: { enabled: true, timeoutMinutes: 5 } }) as any,
      recoverFault: recoverBridgeFault,
      triggerRestart,
      restartProcess,
      logger,
    });

    // 5분마다 Bridge B fault 복구 발생 시뮬레이션
    await service.schedule({
      key: 'serial:port_b',
      portId: 'port_b',
      reason: 'serial error',
    });

    // 5분 경과: 1차 fault 복구
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(bridgeB.start).toHaveBeenCalledTimes(1);
    expect(restartProcess).not.toHaveBeenCalled();

    // 또 다른 fault 발생
    await service.schedule({
      key: 'serial:port_b',
      portId: 'port_b',
      reason: 'serial error',
    });

    // 5분 경과 (총 10분 경과): 2차 fault 복구
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(bridgeB.start).toHaveBeenCalledTimes(2);
    expect(restartProcess).not.toHaveBeenCalled();

    // 추가 50분 경과 (총 60분 경과): LogRetention의 1시간 타이머 정상 발화 확인
    await vi.advanceTimersByTimeAsync(50 * 60 * 1000);
    expect(logRetentionSaveCount).toBe(1);

    clearInterval(logRetentionTimer);
  });
});
