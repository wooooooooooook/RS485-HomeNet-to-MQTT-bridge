import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GenericDevice } from '../src/protocol/devices/generic.device';
import { CommandManager } from '../src/service/command.manager';
import { eventBus } from '../src/service/event-bus';
import { ProtocolConfig } from '../src/protocol/types';
import { Duplex } from 'stream';
import { HomenetBridgeConfig } from '../src/config/types';
import { EntityConfig } from '../src/domain/entities/base.entity';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    isLevelEnabled: vi.fn(),
  },
}));

class MockStream extends Duplex {
  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    callback();
  }
  _read(size: number): void {}
}

describe('ACK Matching', () => {
  const protocolConfig: ProtocolConfig = {
    packet_defaults: {
      tx_checksum: 'none',
    },
  };

  describe('CEL-based ACK extraction', () => {
    it('should return number[] when CEL returns a single flat array', () => {
      const config = {
        id: 'test_device',
        name: 'test_device',
        command_test: '[0x01, 0x02, 0x03]',
      };

      const device = new GenericDevice(config, protocolConfig);
      const result = device.constructCommand('test');

      expect(result).toEqual([0x01, 0x02, 0x03]);
    });

    it('should return CommandResult with ack when CEL returns 2 arrays', () => {
      const config = {
        id: 'test_device',
        name: 'test_device',
        command_test: '[[0x01, 0x02], [0x81, 0x82]]',
      };

      const device = new GenericDevice(config, protocolConfig);
      const result = device.constructCommand('test');

      expect(result).toEqual({
        packet: [0x01, 0x02],
        ack: { data: [0x81, 0x82] },
      });
    });

    it('should return CommandResult with ack:data and ack:mask when CEL returns 3 arrays', () => {
      const config = {
        id: 'test_device',
        name: 'test_device',
        command_test: '[[0x01, 0x02], [0x81, 0x82], [0xFF, 0xF0]]',
      };

      const device = new GenericDevice(config, protocolConfig);
      const result = device.constructCommand('test');

      expect(result).toEqual({
        packet: [0x01, 0x02],
        ack: { data: [0x81, 0x82], mask: [0xff, 0xf0] },
      });
    });

    it('should include input value in packet when using CEL with x variable', () => {
      const config = {
        id: 'test_device',
        name: 'test_device',
        command_temperature: '[[0x36, 0x11, 0x44, int(x)], [0x36, 0x11, 0xC4]]',
      };

      const device = new GenericDevice(config, protocolConfig);
      const result = device.constructCommand('temperature', 25);

      expect(result).toEqual({
        packet: [0x36, 0x11, 0x44, 25],
        ack: { data: [0x36, 0x11, 0xc4] },
      });
    });
  });

  describe('CommandManager ACK handling with ackMatch', () => {
    let commandManager: CommandManager;
    let serialPort: MockStream;
    let config: HomenetBridgeConfig;
    let packetProcessor: any;

    beforeEach(() => {
      vi.useFakeTimers();
      serialPort = new MockStream();
      config = {
        serial: {
          portId: 'main',
          baud_rate: 9600,
          data_bits: 8,
          parity: 'none',
          stop_bits: 1,
        } as any,
        packet_defaults: {
          tx_retry_cnt: 2,
          tx_timeout: 100,
          tx_delay: 50,
        },
      };

      // Mock packetProcessor
      packetProcessor = {
        on: vi.fn(),
        emit: vi.fn(),
        removeListener: vi.fn(),
      };

      commandManager = new CommandManager(serialPort, config, 'main', packetProcessor);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const testEntity: EntityConfig = { id: 'test_button', name: 'Test Button', type: 'button' };
    const testPacket = [0x31, 0x01, 0x00];

    it('should resolve when ack packet is received matching ackMatch', async () => {
      const writeSpy = vi.spyOn(serialPort, 'write');
      const ackMatch = { data: [0x31, 0x81] }; // ACK pattern

      const sendPromise = commandManager.send(testEntity, testPacket, { ackMatch });

      // Verify packetProcessor.on was called for 'packet' event
      expect(packetProcessor.on).toHaveBeenCalledWith('packet', expect.any(Function));

      // Get the packet callback
      const packetCallback = packetProcessor.on.mock.calls.find(
        (call: any[]) => call[0] === 'packet',
      )[1];

      // Wait a bit and simulate ACK packet reception
      await vi.advanceTimersByTimeAsync(50);
      packetCallback(Buffer.from([0x31, 0x81, 0x00, 0xb2])); // Packet that matches ack pattern

      await expect(sendPromise).resolves.toBeUndefined();
      expect(writeSpy).toHaveBeenCalledOnce();
    });

    it('should resolve when state:changed event is received', async () => {
      const writeSpy = vi.spyOn(serialPort, 'write');

      const sendPromise = commandManager.send(testEntity, testPacket);

      // Simulate state change event
      await vi.advanceTimersByTimeAsync(50);
      eventBus.emit('state:changed', { entityId: 'test_button', state: { pressed: true } });

      await expect(sendPromise).resolves.toBeUndefined();
      expect(writeSpy).toHaveBeenCalledOnce();
    });

    it('should resolve on whichever comes first: ackMatch or state:changed', async () => {
      const writeSpy = vi.spyOn(serialPort, 'write');
      const ackMatch = { data: [0x31, 0x81] };

      const sendPromise = commandManager.send(testEntity, testPacket, { ackMatch });

      // Emit state:changed first (before ACK packet)
      await vi.advanceTimersByTimeAsync(50);
      eventBus.emit('state:changed', { entityId: 'test_button', state: { pressed: true } });

      // Should resolve without needing the ACK packet
      await expect(sendPromise).resolves.toBeUndefined();
      expect(writeSpy).toHaveBeenCalledOnce();
    });

    it('should not resolve when packet does not match ackMatch', async () => {
      const ackMatch = { data: [0x31, 0x81] }; // Expect [0x31, 0x81, ...]

      const sendPromise = commandManager.send(testEntity, testPacket, { ackMatch });

      expect(packetProcessor.on).toHaveBeenCalledWith('packet', expect.any(Function));
      const packetCallback = packetProcessor.on.mock.calls.find(
        (call: any[]) => call[0] === 'packet',
      )[1];

      // Send non-matching packet
      await vi.advanceTimersByTimeAsync(50);
      packetCallback(Buffer.from([0x99, 0x99, 0x99])); // Does not match ack pattern

      // Should not resolve yet, will eventually timeout and retry
      vi.runAllTimers();

      // Should resolve after all retries (without throwing)
      await expect(sendPromise).resolves.toBeUndefined();
    });
  });
});
