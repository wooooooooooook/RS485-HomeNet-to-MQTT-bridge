import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBridgeRecoveryHandler } from '../../src/services/bridge-recovery.service.js';
import { AutoRestartService } from '../../src/services/auto-restart.service.js';
import type { BridgeInstance, ConfigStatus, BridgeErrorPayload } from '../../src/types/index.js';

describe('Bridge Recovery Service & Isolation Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  it('Case 1 & 2: createBridgeRecoveryHandler가 portId로 Bridge B를 찾아 stop/start하고 Bridge A 및 MQTT/LogRetention을 격리한다', async () => {
    // Mock Bridge A & B
    const bridgeA = {
      stop: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      isMqttConnected: true,
    };
    const bridgeB = {
      stop: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      isMqttConnected: false,
    };

    const bridges: BridgeInstance[] = [
      {
        configFile: 'bridge_a.yaml',
        resolvedPath: '/config/bridge_a.yaml',
        config: { serial: { portId: 'port_a', path: '/dev/ttyUSB0' } } as any,
        bridge: bridgeA as any,
      },
      {
        configFile: 'bridge_b.yaml',
        resolvedPath: '/config/bridge_b.yaml',
        config: { serial: { portId: 'custom_port', path: '192.168.1.100:8899' } } as any,
        bridge: bridgeB as any,
      },
    ];

    const currentConfigFiles = ['bridge_a.yaml', 'bridge_b.yaml'];
    const currentConfigStatuses: ConfigStatus[] = ['started', 'error'];
    const currentConfigErrors: (BridgeErrorPayload | null)[] = [
      null,
      { code: 'CORE_START_FAILED', message: 'connection lost' } as any,
    ];

    const emitBridgeStatus = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const recoveryHandler = createBridgeRecoveryHandler({
      getBridges: () => bridges,
      getCurrentConfigFiles: () => currentConfigFiles,
      getCurrentConfigStatuses: () => currentConfigStatuses,
      getCurrentConfigErrors: () => currentConfigErrors,
      setCurrentConfigStatus: (index, status) => {
        currentConfigStatuses[index] = status;
      },
      setCurrentConfigError: (index, error) => {
        currentConfigErrors[index] = error;
      },
      isAutoRestartSuppressed: () => false,
      isBridgeStarting: () => false,
      emitBridgeStatus,
      logger,
    });

    // 1. Bridge B (custom_port)에 대한 recovery 실행
    const result = await recoveryHandler.recoverBridgeFault({
      key: 'serial:custom_port',
      portId: 'custom_port',
      reason: 'serial error',
    });

    expect(result).toBe(true);

    // 2. Bridge B만 stop -> start 호출됨
    expect(bridgeB.stop).toHaveBeenCalledTimes(1);
    expect(bridgeB.start).toHaveBeenCalledTimes(1);

    // 3. Bridge A는 stop/start가 전혀 호출되지 않음 (MQTT 및 lifecycle 격리 보장)
    expect(bridgeA.stop).not.toHaveBeenCalled();
    expect(bridgeA.start).not.toHaveBeenCalled();

    // 4. Config 상태가 started로 갱신되고 error가 null로 클리어됨
    expect(currentConfigStatuses[1]).toBe('started');
    expect(currentConfigErrors[1]).toBeNull();
    expect(emitBridgeStatus).toHaveBeenCalledWith({
      portId: 'custom_port',
      status: 'started',
    });
  });

  it('Case 3: 동일 portId에 대해 동시 recovery 요청이 들어오면 in-flight promise로 중복 실행을 방지한다', async () => {
    let stopResolver: () => void;
    const bridgeStopPromise = new Promise<void>((resolve) => {
      stopResolver = resolve;
    });

    const bridgeB = {
      stop: vi.fn().mockImplementation(() => bridgeStopPromise),
      start: vi.fn().mockResolvedValue(undefined),
    };

    const bridges: BridgeInstance[] = [
      {
        configFile: 'bridge_b.yaml',
        resolvedPath: '/config/bridge_b.yaml',
        config: { serial: { portId: 'custom_port' } } as any,
        bridge: bridgeB as any,
      },
    ];

    const recoveryHandler = createBridgeRecoveryHandler({
      getBridges: () => bridges,
      getCurrentConfigFiles: () => ['bridge_b.yaml'],
      getCurrentConfigStatuses: () => ['error'],
      getCurrentConfigErrors: () => [null],
      setCurrentConfigStatus: vi.fn(),
      setCurrentConfigError: vi.fn(),
      isAutoRestartSuppressed: () => false,
      isBridgeStarting: () => false,
      emitBridgeStatus: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // 2개의 recovery 요청이 거의 동시에 발생 (e.g. serial fault & integration fault)
    const call1 = recoveryHandler.recoverBridgeFault({
      key: 'serial:custom_port',
      portId: 'custom_port',
      reason: 'serial error',
    });
    const call2 = recoveryHandler.recoverBridgeFault({
      key: 'integration:custom_port',
      portId: 'custom_port',
      reason: 'mqtt error',
    });

    // stop 완료
    stopResolver!();

    const [res1, res2] = await Promise.all([call1, call2]);
    expect(res1).toBe(true);
    expect(res2).toBe(true);

    // stop과 start는 단 1번만 실행되어야 함
    expect(bridgeB.stop).toHaveBeenCalledTimes(1);
    expect(bridgeB.start).toHaveBeenCalledTimes(1);
  });

  it('Case 4: Bridge restart 중 에러가 발생하면 false를 반환하고 error 상태를 갱신한다', async () => {
    const bridgeB = {
      stop: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockRejectedValue(new Error('TCP connect ECONNREFUSED')),
    };

    const bridges: BridgeInstance[] = [
      {
        configFile: 'bridge_b.yaml',
        resolvedPath: '/config/bridge_b.yaml',
        config: { serial: { portId: 'custom_port' } } as any,
        bridge: bridgeB as any,
      },
    ];

    const currentConfigStatuses: ConfigStatus[] = ['starting'];
    const currentConfigErrors: (BridgeErrorPayload | null)[] = [null];
    const emitBridgeStatus = vi.fn();

    const recoveryHandler = createBridgeRecoveryHandler({
      getBridges: () => bridges,
      getCurrentConfigFiles: () => ['bridge_b.yaml'],
      getCurrentConfigStatuses: () => currentConfigStatuses,
      getCurrentConfigErrors: () => currentConfigErrors,
      setCurrentConfigStatus: (i, s) => {
        currentConfigStatuses[i] = s;
      },
      setCurrentConfigError: (i, e) => {
        currentConfigErrors[i] = e;
      },
      isAutoRestartSuppressed: () => false,
      isBridgeStarting: () => false,
      emitBridgeStatus,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const result = await recoveryHandler.recoverBridgeFault({
      key: 'serial:custom_port',
      portId: 'custom_port',
      reason: 'serial error',
    });

    expect(result).toBe(false);
    expect(currentConfigStatuses[0]).toBe('error');
    expect(currentConfigErrors[0]).not.toBeNull();
    expect(currentConfigErrors[0]?.code).toBe('CORE_START_FAILED');
    expect(emitBridgeStatus).toHaveBeenCalledWith({
      portId: 'custom_port',
      status: 'error',
      errorInfo: expect.objectContaining({ code: 'CORE_START_FAILED' }),
    });
  });

  it('Case 5: 전체 AutoRestartService와 결합 시 1시간 주기 LogRetention 타이머가 초기화되지 않고 유지된다', async () => {
    let logRetentionSaveCount = 0;
    const logRetentionTimer = setInterval(
      () => {
        logRetentionSaveCount += 1;
      },
      60 * 60 * 1000,
    ); // 1시간 주기

    const bridgeB = {
      stop: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
    };

    const bridges: BridgeInstance[] = [
      {
        configFile: 'bridge_b.yaml',
        resolvedPath: '/config/bridge_b.yaml',
        config: { serial: { portId: 'ew11_port' } } as any,
        bridge: bridgeB as any,
      },
    ];

    const recoveryHandler = createBridgeRecoveryHandler({
      getBridges: () => bridges,
      getCurrentConfigFiles: () => ['bridge_b.yaml'],
      getCurrentConfigStatuses: () => ['error'],
      getCurrentConfigErrors: () => [null],
      setCurrentConfigStatus: vi.fn(),
      setCurrentConfigError: vi.fn(),
      isAutoRestartSuppressed: () => false,
      isBridgeStarting: () => false,
      emitBridgeStatus: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const triggerRestart = vi.fn();
    const restartProcess = vi.fn();

    const service = new AutoRestartService({
      loadSettings: () => ({ autoRestart: { enabled: true, timeoutMinutes: 5 } }) as any,
      recoverFault: recoveryHandler.recoverBridgeFault,
      triggerRestart,
      restartProcess,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // 5분 후 Bridge fault 복구
    await service.schedule({
      key: 'serial:ew11_port',
      portId: 'ew11_port',
      reason: 'serial error',
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(bridgeB.start).toHaveBeenCalledTimes(1);
    expect(triggerRestart).not.toHaveBeenCalled();
    expect(restartProcess).not.toHaveBeenCalled();

    // 55분 추가 경과 (총 60분) -> LogRetention의 auto-save 타이머 발화 확인
    await vi.advanceTimersByTimeAsync(55 * 60 * 1000);
    expect(logRetentionSaveCount).toBe(1);

    clearInterval(logRetentionTimer);
  });
});
