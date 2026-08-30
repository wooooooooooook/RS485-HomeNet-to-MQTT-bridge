import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoRestartService } from '../../src/services/auto-restart.service.js';
import type { FrontendSettings } from '../../src/types/index.js';

const makeSettings = (autoRestart: FrontendSettings['autoRestart']): FrontendSettings => ({
  toast: { stateChange: false, command: true },
  autoRestart,
});

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('AutoRestartService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('설정된 장애 지속 시간이 지나면 재시작을 트리거한다', async () => {
    const triggerRestart = vi.fn().mockResolvedValue(undefined);
    const restartProcess = vi.fn();
    const service = new AutoRestartService({
      loadSettings: () => makeSettings({ enabled: true, timeoutMinutes: 5 }),
      triggerRestart,
      restartProcess,
      logger,
    });

    await service.schedule({ key: 'mqtt:default', reason: 'mqtt disconnected' });
    expect(service.getPending()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(triggerRestart).toHaveBeenCalledTimes(1);
    expect(restartProcess).toHaveBeenCalledTimes(1);
    expect(service.getPending()).toHaveLength(0);
  });

  it('복구되면 예약된 자동 재시작을 취소한다', async () => {
    const triggerRestart = vi.fn().mockResolvedValue(undefined);
    const restartProcess = vi.fn();
    const service = new AutoRestartService({
      loadSettings: () => makeSettings({ enabled: true, timeoutMinutes: 5 }),
      triggerRestart,
      restartProcess,
      logger,
    });

    await service.schedule({ key: 'serial:default', reason: 'serial reconnecting' });
    service.clear('serial:default');
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(triggerRestart).not.toHaveBeenCalled();
    expect(restartProcess).not.toHaveBeenCalled();
    expect(service.getPending()).toHaveLength(0);
  });

  it('자동 재시작 설정이 꺼져 있으면 예약하지 않는다', async () => {
    const service = new AutoRestartService({
      loadSettings: () => makeSettings({ enabled: false, timeoutMinutes: 5 }),
      triggerRestart: vi.fn(),
      restartProcess: vi.fn(),
      logger,
    });

    await service.schedule({ key: 'mqtt:default', reason: 'mqtt disconnected' });

    expect(service.getPending()).toHaveLength(0);
  });

  it('portId가 있고 recoverFault가 성공하면 프로세스 재시작 없이 브리지만 복구한다', async () => {
    const triggerRestart = vi.fn().mockResolvedValue(undefined);
    const restartProcess = vi.fn();
    const recoverFault = vi.fn().mockResolvedValue(true);
    const service = new AutoRestartService({
      loadSettings: () => makeSettings({ enabled: true, timeoutMinutes: 5 }),
      recoverFault,
      triggerRestart,
      restartProcess,
      logger,
    });

    await service.schedule({
      key: 'serial:custom_port',
      portId: 'custom_port',
      reason: 'serial error',
    });
    expect(service.getPending()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(recoverFault).toHaveBeenCalledTimes(1);
    expect(recoverFault).toHaveBeenCalledWith({
      key: 'serial:custom_port',
      portId: 'custom_port',
      reason: 'serial error',
    });
    expect(triggerRestart).not.toHaveBeenCalled();
    expect(restartProcess).not.toHaveBeenCalled();
    expect(service.getPending()).toHaveLength(0);
    expect(service.getRecoveryAttempts('serial:custom_port')).toBe(0);
  });

  it('recoverFault가 실패하면 retry를 스케줄링하고, 연속 실패 시 프로세스 재시작 fallback을 수행한다', async () => {
    const triggerRestart = vi.fn().mockResolvedValue(undefined);
    const restartProcess = vi.fn();
    const recoverFault = vi.fn().mockResolvedValue(false);
    const service = new AutoRestartService({
      loadSettings: () => makeSettings({ enabled: true, timeoutMinutes: 5 }),
      recoverFault,
      triggerRestart,
      restartProcess,
      maxBridgeRecoveryAttempts: 3,
      logger,
    });

    await service.schedule({
      key: 'serial:ew11_port',
      portId: 'ew11_port',
      reason: 'serial error',
    });

    // 1차 시도 (5분 후) -> 실패 후 재스케줄
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(recoverFault).toHaveBeenCalledTimes(1);
    expect(triggerRestart).not.toHaveBeenCalled();
    expect(restartProcess).not.toHaveBeenCalled();
    expect(service.getPending()).toHaveLength(1);
    expect(service.getRecoveryAttempts('serial:ew11_port')).toBe(1);

    // 2차 시도 (추가 5분 후) -> 실패 후 재스케줄
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(recoverFault).toHaveBeenCalledTimes(2);
    expect(triggerRestart).not.toHaveBeenCalled();
    expect(restartProcess).not.toHaveBeenCalled();
    expect(service.getPending()).toHaveLength(1);
    expect(service.getRecoveryAttempts('serial:ew11_port')).toBe(2);

    // 3차 시도 (추가 5분 후) -> 최대 시도 도달, 전체 프로세스 재시작 fallback 실행
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(recoverFault).toHaveBeenCalledTimes(3);
    expect(triggerRestart).toHaveBeenCalledTimes(1);
    expect(restartProcess).toHaveBeenCalledTimes(1);
    expect(service.getPending()).toHaveLength(0);
  });

  it('recoverFault가 재시도 중 성공하면 attempts 카운트가 초기화되고 프로세스 재시작을 하지 않는다', async () => {
    const triggerRestart = vi.fn().mockResolvedValue(undefined);
    const restartProcess = vi.fn();
    const recoverFault = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const service = new AutoRestartService({
      loadSettings: () => makeSettings({ enabled: true, timeoutMinutes: 5 }),
      recoverFault,
      triggerRestart,
      restartProcess,
      maxBridgeRecoveryAttempts: 3,
      logger,
    });

    await service.schedule({
      key: 'serial:retry_port',
      portId: 'retry_port',
      reason: 'serial error',
    });

    // 1차 시도 -> 실패
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(recoverFault).toHaveBeenCalledTimes(1);
    expect(triggerRestart).not.toHaveBeenCalled();

    // 2차 시도 -> 성공
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(recoverFault).toHaveBeenCalledTimes(2);
    expect(triggerRestart).not.toHaveBeenCalled();
    expect(restartProcess).not.toHaveBeenCalled();
    expect(service.getPending()).toHaveLength(0);
    expect(service.getRecoveryAttempts('serial:retry_port')).toBe(0);
  });

  it('recovery 도중 새 fault가 발생하면 이전 recovery 완료가 새 fault를 지우지 않는다', async () => {
    let serviceRef: AutoRestartService | null = null;
    const recoverFault = vi.fn().mockImplementation(async () => {
      // 복구 도중 새로운 connection error 발생하여 새 fault schedule 시뮬레이션
      if (serviceRef) {
        await serviceRef.schedule({
          key: 'serial:race_port',
          portId: 'race_port',
          reason: 'serial new error during start',
        });
      }
      return true;
    });

    const triggerRestart = vi.fn();
    const restartProcess = vi.fn();

    const service = new AutoRestartService({
      loadSettings: () => makeSettings({ enabled: true, timeoutMinutes: 5 }),
      recoverFault,
      triggerRestart,
      restartProcess,
      logger,
    });
    serviceRef = service;

    // 1. 최초 fault 스케줄
    await service.schedule({
      key: 'serial:race_port',
      portId: 'race_port',
      reason: 'initial serial disconnect',
    });
    const initialGen = service.getCurrentGeneration('serial:race_port');
    expect(initialGen).toBeDefined();

    // 2. 5분 후 1차 recovery 실행 -> 내부에서 새 fault 스케줄됨
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(recoverFault).toHaveBeenCalledTimes(1);
    // 새 fault가 여전히 pending에 남아있어야 함 (지워지지 않음)
    const pending = service.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].reason).toBe('serial new error during start');
    expect(pending[0].generation).toBeGreaterThan(initialGen!);

    // 3. 만약 이전 recovery 완료 후 clear(key, initialGen)을 시도해도 새 generation은 보호됨
    service.clear('serial:race_port', initialGen);
    expect(service.getPending()).toHaveLength(1);

    // 4. 새 fault의 5분 타이머가 지나면 다시 recovery가 호출됨
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(recoverFault).toHaveBeenCalledTimes(2);
  });
});
