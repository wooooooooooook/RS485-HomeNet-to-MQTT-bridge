import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSerialPortConnection } from '../../../src/transports/serial/serial.factory.js';
import * as serialConnection from '../../../src/transports/serial/serial.connection.js';
import { ReconnectingTcpSocket } from '../../../src/transports/serial/tcp-socket.js';
import { SerialPort } from 'serialport';

// Mocks
vi.mock('serialport', () => ({
  SerialPort: vi.fn(),
}));

vi.mock('../../../src/transports/serial/serial.connection.js', () => ({
  isTcpConnection: vi.fn(),
  waitForSerialDevice: vi.fn(),
  openSerialPort: vi.fn(),
}));

vi.mock('../../../src/transports/serial/tcp-socket.js', () => ({
  ReconnectingTcpSocket: vi.fn(),
}));

describe('createSerialPortConnection', () => {
  const mockSerialConfig = {
    baud_rate: 9600,
    data_bits: 8,
    parity: 'none',
    stop_bits: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers(); // Ensure timers are reset
  });

  describe('TCP Connection', () => {
    beforeEach(() => {
      vi.mocked(serialConnection.isTcpConnection).mockReturnValue(true);
    });

    it('should create a ReconnectingTcpSocket and connect successfully', async () => {
      const mockSocket = {
        connect: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn(),
      } as unknown as ReconnectingTcpSocket;

      vi.mocked(ReconnectingTcpSocket).mockImplementation(() => mockSocket);

      const result = await createSerialPortConnection('192.168.1.100:8888', mockSerialConfig as any);

      expect(serialConnection.isTcpConnection).toHaveBeenCalledWith('192.168.1.100:8888');
      expect(ReconnectingTcpSocket).toHaveBeenCalledWith('192.168.1.100', 8888, expect.objectContaining({
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        connectionTimeoutMs: 5000,
      }));
      expect(mockSocket.connect).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockSocket);
    });

    it('should retry connection on failure and succeed', async () => {
      vi.useFakeTimers();
      const mockSocket = {
        connect: vi.fn()
          .mockRejectedValueOnce(new Error('Connection failed'))
          .mockResolvedValue(undefined),
        destroy: vi.fn(),
      } as unknown as ReconnectingTcpSocket;

      vi.mocked(ReconnectingTcpSocket).mockImplementation(() => mockSocket);

      const connectionPromise = createSerialPortConnection('192.168.1.100:8888', mockSerialConfig as any);

      // Advance timers to trigger retry
      await vi.advanceTimersByTimeAsync(2000);

      const result = await connectionPromise;

      expect(mockSocket.connect).toHaveBeenCalledTimes(2);
      expect(result).toBe(mockSocket);
    });

    it('should fail after max retries and destroy socket', async () => {
      vi.useFakeTimers();
      const mockSocket = {
        connect: vi.fn().mockRejectedValue(new Error('Connection failed')),
        destroy: vi.fn(),
      } as unknown as ReconnectingTcpSocket;

      vi.mocked(ReconnectingTcpSocket).mockImplementation(() => mockSocket);

      const connectionPromise = createSerialPortConnection('192.168.1.100:8888', mockSerialConfig as any);

      // Advance timers to trigger all retries
      await vi.advanceTimersByTimeAsync(10000);

      await expect(connectionPromise).rejects.toThrow('Connection failed');
      expect(mockSocket.connect).toHaveBeenCalledTimes(4);
      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('should respect custom timeout', async () => {
      const mockSocket = {
        connect: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn(),
      } as unknown as ReconnectingTcpSocket;

      vi.mocked(ReconnectingTcpSocket).mockImplementation(() => mockSocket);

      await createSerialPortConnection('192.168.1.100:8888', mockSerialConfig as any, 10000);

      expect(ReconnectingTcpSocket).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.objectContaining({ connectionTimeoutMs: 10000 })
      );
    });

    it('should not retry if timeoutMs is provided', async () => {
        const mockSocket = {
            connect: vi.fn().mockRejectedValue(new Error('Fail')),
            destroy: vi.fn(),
        } as unknown as ReconnectingTcpSocket;

        vi.mocked(ReconnectingTcpSocket).mockImplementation(() => mockSocket);

        await expect(createSerialPortConnection('host:1234', mockSerialConfig as any, 500)).rejects.toThrow('Fail');
        expect(mockSocket.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Serial Connection', () => {
    beforeEach(() => {
      vi.mocked(serialConnection.isTcpConnection).mockReturnValue(false);
    });

    it('should create and open a SerialPort successfully', async () => {
      const mockSerialPort = {} as SerialPort;
      vi.mocked(SerialPort).mockImplementation(() => mockSerialPort);
      vi.mocked(serialConnection.waitForSerialDevice).mockResolvedValue(undefined);
      vi.mocked(serialConnection.openSerialPort).mockResolvedValue(undefined);

      const result = await createSerialPortConnection('/dev/ttyUSB0', mockSerialConfig as any);

      expect(serialConnection.isTcpConnection).toHaveBeenCalledWith('/dev/ttyUSB0');
      expect(serialConnection.waitForSerialDevice).toHaveBeenCalledWith('/dev/ttyUSB0', undefined);
      expect(SerialPort).toHaveBeenCalledWith({
        path: '/dev/ttyUSB0',
        baudRate: 9600,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        autoOpen: false,
      });
      expect(serialConnection.openSerialPort).toHaveBeenCalledWith(mockSerialPort);
      expect(result).toBe(mockSerialPort);
    });

    it('should pass timeoutMs to waitForSerialDevice', async () => {
        const mockSerialPort = {} as SerialPort;
        vi.mocked(SerialPort).mockImplementation(() => mockSerialPort);
        vi.mocked(serialConnection.waitForSerialDevice).mockResolvedValue(undefined);
        vi.mocked(serialConnection.openSerialPort).mockResolvedValue(undefined);

        await createSerialPortConnection('/dev/ttyUSB0', mockSerialConfig as any, 5000);

        expect(serialConnection.waitForSerialDevice).toHaveBeenCalledWith('/dev/ttyUSB0', 5000);
    });

    it('should throw if waitForSerialDevice fails', async () => {
      vi.mocked(serialConnection.waitForSerialDevice).mockRejectedValue(new Error('Device not found'));

      await expect(createSerialPortConnection('/dev/ttyUSB0', mockSerialConfig as any))
        .rejects.toThrow('Device not found');

      expect(SerialPort).not.toHaveBeenCalled();
    });

    it('should throw if openSerialPort fails', async () => {
      const mockSerialPort = {} as SerialPort;
      vi.mocked(SerialPort).mockImplementation(() => mockSerialPort);
      vi.mocked(serialConnection.waitForSerialDevice).mockResolvedValue(undefined);
      vi.mocked(serialConnection.openSerialPort).mockRejectedValue(new Error('Access denied'));

      await expect(createSerialPortConnection('/dev/ttyUSB0', mockSerialConfig as any))
        .rejects.toThrow('Access denied');
    });
  });
});
