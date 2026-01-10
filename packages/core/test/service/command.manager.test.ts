// packages/core/test/service/command.manager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandManager } from '../../src/service/command.manager';
import { Duplex } from 'stream';
import { HomenetBridgeConfig } from '../../src/config/types';
import { EntityConfig } from '../../src/domain/entities/base.entity';
import { eventBus } from '../../src/service/event-bus';

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

class MockStream extends Duplex {
  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback();
  }
  _read(size: number): void {}
}

describe('CommandManager', () => {
  let commandManager: CommandManager;
  let serialPort: MockStream;
  let config: HomenetBridgeConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    serialPort = new MockStream();
    config = {
      serial: {
        portId: 'main',
        path: '/dev/ttyUSB0',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      packet_defaults: {
        tx_retry_cnt: 2,
        tx_timeout: 100,
        tx_delay: 50,
      },
    };
    commandManager = new CommandManager(serialPort, config, 'main');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const testEntity: EntityConfig = { id: 'test_light', name: 'Test Light', type: 'light' };
  const testPacket = [0x01, 0x02, 0x03];

  it('should send a command and resolve on ACK', async () => {
    const writeSpy = vi.spyOn(serialPort, 'write');
    const sendPromise = commandManager.send(testEntity, testPacket);

    await vi.advanceTimersByTimeAsync(10);
    eventBus.emit('state:changed', { entityId: 'test_light', state: {} });

    await expect(sendPromise).resolves.toBeUndefined();
    expect(writeSpy).toHaveBeenCalledOnce();
  });

  it('should retry sending a command and resolve on ACK', async () => {
    const writeSpy = vi.spyOn(serialPort, 'write');
    const sendPromise = commandManager.send(testEntity, testPacket);

    // First attempt times out
    await vi.advanceTimersByTimeAsync(100);
    // Interval before retry
    await vi.advanceTimersByTimeAsync(50);

    expect(writeSpy).toHaveBeenCalledTimes(2);

    // ACK received after second attempt
    eventBus.emit('state:changed', { entityId: 'test_light', state: {} });

    await expect(sendPromise).resolves.toBeUndefined();
  });

  it('should resolve after all retry attempts fail', async () => {
    const writeSpy = vi.spyOn(serialPort, 'write');
    const sendPromise = commandManager.send(testEntity, testPacket);

    // Let all timers run until the promise settles
    vi.runAllTimers();

    await expect(sendPromise).resolves.toBeUndefined();
    // total attempts = initial (1) + retries (2) = 3
    expect(writeSpy).toHaveBeenCalledTimes(config.packet_defaults!.tx_retry_cnt! + 1);
  });

  it('should use entity-specific retry config', async () => {
    const writeSpy = vi.spyOn(serialPort, 'write');
    const specificEntity: EntityConfig = {
      ...testEntity,
      packet_parameters: { tx_retry_cnt: 1, tx_timeout: 200, tx_delay: 100 },
    };
    const sendPromise = commandManager.send(specificEntity, testPacket);

    // Let all timers run
    vi.runAllTimers();

    await expect(sendPromise).resolves.toBeUndefined();
    // total attempts = initial (1) + retries (1) = 2
    expect(writeSpy).toHaveBeenCalledTimes(specificEntity.packet_parameters!.tx_retry_cnt! + 1);
  });

  it('should process commands in a queue', async () => {
    const writeSpy = vi.spyOn(serialPort, 'write');
    const entity2: EntityConfig = { id: 'test_light_2', name: 'Test Light 2', type: 'light' };

    const promise1 = commandManager.send(testEntity, testPacket);
    const promise2 = commandManager.send(entity2, testPacket);

    // Only the first command should be sent initially
    expect(writeSpy).toHaveBeenCalledOnce();

    // ACK for the first command
    await vi.advanceTimersByTimeAsync(10);
    eventBus.emit('state:changed', { entityId: 'test_light', state: {} });
    await promise1;

    // Process queue for the second command
    await vi.advanceTimersByTimeAsync(1);

    // Now the second command should have been sent
    expect(writeSpy).toHaveBeenCalledTimes(2);

    // ACK for the second command
    await vi.advanceTimersByTimeAsync(10);
    eventBus.emit('state:changed', { entityId: 'test_light_2', state: {} });

    await expect(promise2).resolves.toBeUndefined();
  });

  it('should process low priority commands only when normal queue is empty', async () => {
    const writeSpy = vi.spyOn(serialPort, 'write');
    const entity2: EntityConfig = { id: 'test_light_2', name: 'Test Light 2', type: 'light' };

    // Send normal priority command
    const promise1 = commandManager.send(testEntity, testPacket);
    // Send low priority command
    const promise2 = commandManager.send(entity2, testPacket, { priority: 'low' });

    // Only the first command should be sent initially (normal priority)
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenLastCalledWith(Buffer.from(testPacket));

    // ACK for the first command
    await vi.advanceTimersByTimeAsync(10);
    eventBus.emit('state:changed', { entityId: 'test_light', state: {} });
    await promise1;

    // Now low priority command should be sent
    await vi.advanceTimersByTimeAsync(1);
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenLastCalledWith(Buffer.from(testPacket));

    // ACK for the second command
    await vi.advanceTimersByTimeAsync(10);
    eventBus.emit('state:changed', { entityId: 'test_light_2', state: {} });
    await promise2;
  });

  it('should prioritize normal priority commands over low priority commands', async () => {
    const writeSpy = vi.spyOn(serialPort, 'write');
    const entityLow: EntityConfig = { id: 'low_prio', name: 'Low Prio', type: 'light' };
    const entityHigh: EntityConfig = { id: 'high_prio', name: 'High Prio', type: 'light' };
    const packetLow = [0xaa];
    const packetHigh = [0xbb];

    // Start a command to block the queue
    const promise1 = commandManager.send(testEntity, testPacket);

    // Queue a low priority command
    const promiseLow = commandManager.send(entityLow, packetLow, { priority: 'low' });
    // Queue a high priority command
    const promiseHigh = commandManager.send(entityHigh, packetHigh, { priority: 'normal' });

    // Only first command sent
    expect(writeSpy).toHaveBeenCalledTimes(1);

    // ACK first command
    await vi.advanceTimersByTimeAsync(10);
    eventBus.emit('state:changed', { entityId: 'test_light', state: {} });
    await promise1;

    // Next should be high priority command, not low priority
    await vi.advanceTimersByTimeAsync(1);
    expect(writeSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy).toHaveBeenLastCalledWith(Buffer.from(packetHigh));

    // ACK high priority command
    await vi.advanceTimersByTimeAsync(10);
    eventBus.emit('state:changed', { entityId: 'high_prio', state: {} });
    await promiseHigh;

    // Finally low priority command
    await vi.advanceTimersByTimeAsync(1);
    expect(writeSpy).toHaveBeenCalledTimes(3);
    expect(writeSpy).toHaveBeenLastCalledWith(Buffer.from(packetLow));

    // ACK low priority command
    await vi.advanceTimersByTimeAsync(10);
    eventBus.emit('state:changed', { entityId: 'low_prio', state: {} });
    await promiseLow;
  });
});
