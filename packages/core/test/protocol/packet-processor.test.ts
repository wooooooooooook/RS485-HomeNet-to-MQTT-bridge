import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PacketProcessor } from '../../src/protocol/packet-processor';
import { ProtocolManager } from '../../src/protocol/protocol-manager';
import { GenericDevice } from '../../src/protocol/devices/generic.device';
import { HomenetBridgeConfig } from '../../src/config/types';
import { EntityConfig } from '../../src/domain/entities/base.entity';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';

// Mock ProtocolManager
vi.mock('../../src/protocol/protocol-manager.js', () => {
  return {
    ProtocolManager: vi.fn().mockImplementation((config) => {
      const handlers: Record<string, Function[]> = {};
      return {
        config,
        registerDevice: vi.fn(),
        handleIncomingChunk: vi.fn(),
        getDevice: vi.fn(),
        on: vi.fn((event: string, handler: Function) => {
          if (!handlers[event]) handlers[event] = [];
          handlers[event].push(handler);
        }),
        emit: vi.fn((event: string, ...args: any[]) => {
          if (handlers[event]) {
            handlers[event].forEach((h) => h(...args));
          }
        }),
      };
    }),
  };
});

// Mock GenericDevice
vi.mock('../../src/protocol/devices/generic.device.js', () => {
  return {
    GenericDevice: vi.fn().mockImplementation((entity) => ({
      entity,
      constructCommand: vi.fn(),
      setErrorReporter: vi.fn(),
      getOptimisticState: vi.fn(),
      getLastError: vi.fn(),
    })),
  };
});

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PacketProcessor', () => {
  let processor: PacketProcessor;
  let mockProtocolManager: any;
  let mockGenericDevice: any;
  let config: HomenetBridgeConfig;
  let stateProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();

    config = {
      packet_defaults: {
        rx_header: [0xaa],
        rx_length: 5,
      },
      light: [
        {
          id: 'light_1',
          name: 'Living Room Light',
          command: 'ON',
        } as EntityConfig,
      ],
    } as HomenetBridgeConfig;

    stateProvider = {
      getLightState: vi.fn(),
      getClimateState: vi.fn(),
      getAllStates: vi.fn().mockReturnValue({}),
      getEntityState: vi.fn(),
    };

    processor = new PacketProcessor(config, stateProvider);
    // Access the private property directly to ensure we have the right instance
    mockProtocolManager = (processor as any).protocolManager;
    mockGenericDevice = (GenericDevice as any).mock.instances[0]; // If instantiated
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
    expect(ProtocolManager).toHaveBeenCalledWith({
      packet_defaults: config.packet_defaults,
      rx_priority: 'data',
    });
  });

  it('should register devices from config', () => {
    // Check if registerDevice was called
    expect(mockProtocolManager.registerDevice).toHaveBeenCalled();

    // The mock GenericDevice (or LightDevice via map) should have been instantiated
    // Since we didn't mock LightDevice specifically, it might use GenericDevice if map fails or defaults
    // But in the code: const deviceMap = { light: LightDevice ... }
    // We only mocked GenericDevice.
    // Wait, if LightDevice is imported, it's the real class.
    // To properly test registration without relying on real device classes,
    // I should probably check what was passed to registerDevice.

    // Let's verify that registerDevice was called with an object that looks like a device
    const registeredDevice = mockProtocolManager.registerDevice.mock.calls[0][0];
    expect(registeredDevice).toBeDefined();
    // Since we didn't mock LightDevice, it's an instance of the real LightDevice
    // We can check if it has the correct entity config
    expect(registeredDevice.entity.id).toBe('light_1');
  });

  it('should forward events from ProtocolManager', () => {
    const stateHandler = vi.fn();
    const packetHandler = vi.fn();
    const parsedPacketHandler = vi.fn();
    const entityErrorHandler = vi.fn();
    const unmatchedPacketHandler = vi.fn();

    processor.on('state', stateHandler);
    processor.on('packet', packetHandler);
    processor.on('parsed-packet', parsedPacketHandler);
    processor.on('entity-error', entityErrorHandler);
    processor.on('unmatched-packet', unmatchedPacketHandler);

    // Emit events from ProtocolManager
    mockProtocolManager.emit('state', { deviceId: 'd1', state: 'ON' });
    mockProtocolManager.emit('packet', [0xaa, 0xbb]);
    mockProtocolManager.emit('parsed-packet', { some: 'data' });
    mockProtocolManager.emit('entity-error', { error: 'oops' });
    mockProtocolManager.emit('unmatched-packet', [0xff]);

    expect(stateHandler).toHaveBeenCalledWith({ deviceId: 'd1', state: 'ON' });
    expect(packetHandler).toHaveBeenCalledWith([0xaa, 0xbb]);
    expect(parsedPacketHandler).toHaveBeenCalledWith({ some: 'data' });
    // Note: entity-error adds portId
    expect(entityErrorHandler).toHaveBeenCalledWith({ error: 'oops', portId: undefined });
    expect(unmatchedPacketHandler).toHaveBeenCalledWith([0xff]);
  });

  it('should process incoming chunk', () => {
    const chunk = Buffer.from([0xaa, 0xbb]);
    processor.processChunk(chunk);
    expect(mockProtocolManager.handleIncomingChunk).toHaveBeenCalledWith(chunk);
  });

  describe('constructCommandPacket', () => {
    it('should construct packet for registered device (Happy Path)', () => {
      const entity: EntityConfig = { id: 'light_1', name: 'Light', command: 'ON' };
      const expectedPacket = [0x01, 0x02];

      const mockDevice = {
        constructCommand: vi.fn().mockReturnValue(expectedPacket),
        getOptimisticState: vi.fn(),
        getLastError: vi.fn(),
        setErrorReporter: vi.fn(),
      };

      mockProtocolManager.getDevice.mockReturnValue(mockDevice);

      const result = processor.constructCommandPacket(entity, 'on');

      expect(mockProtocolManager.getDevice).toHaveBeenCalledWith('light_1');
      expect(mockDevice.constructCommand).toHaveBeenCalledWith('on', undefined, undefined);
      expect(result).toBe(expectedPacket);
    });

    it('should use GenericDevice as fallback if device not found', () => {
      const entity: EntityConfig = { id: 'unknown_1', name: 'Unknown' };
      mockProtocolManager.getDevice.mockReturnValue(undefined);

      // We need to verify that a new GenericDevice was created and used
      // Since GenericDevice is mocked, we can check mock.instances or implementation
      // But the implementation returns an object with constructCommand mock

      // Let's spy on constructCommand of the LAST created instance
      // But we can't easily access it before call.
      // However, we can mock GenericDevice implementation to return a specific mock object
      // for this test OR just check that constructor was called.

      const expectedPacket = [0x03, 0x04];
      const mockConstructCommand = vi.fn().mockReturnValue(expectedPacket);

      // Override mock implementation for this test
      (GenericDevice as any).mockImplementationOnce((ent: any) => ({
        entity: ent,
        constructCommand: mockConstructCommand,
        setErrorReporter: vi.fn(),
        getLastError: vi.fn(),
        getOptimisticState: vi.fn(),
      }));

      const result = processor.constructCommandPacket(entity, 'off');

      expect(mockProtocolManager.getDevice).toHaveBeenCalledWith('unknown_1');
      expect(GenericDevice).toHaveBeenCalledWith(entity, expect.anything());
      expect(mockConstructCommand).toHaveBeenCalledWith('off', undefined, undefined);
      expect(result).toBe(expectedPacket);
    });

    it('should handle errors during command construction', () => {
      const entity: EntityConfig = { id: 'light_1', name: 'Light' };
      const mockDevice = {
        constructCommand: vi.fn().mockImplementation(() => {
          throw new Error('Construction failed');
        }),
        getLastError: vi.fn(),
        setErrorReporter: vi.fn(),
      };
      mockProtocolManager.getDevice.mockReturnValue(mockDevice);

      const errorHandler = vi.fn();
      processor.on('entity-error', errorHandler);

      const result = processor.constructCommandPacket(entity, 'on');

      expect(result).toBeNull();
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'light_1',
          message: 'Construction failed',
          type: 'command',
        }),
      );
    });

    it('should handle optimistic updates', () => {
      const entity: EntityConfig = { id: 'light_1', name: 'Light', optimistic: true };
      const expectedPacket = [0x01];
      const mockDevice = {
        constructCommand: vi.fn().mockReturnValue(expectedPacket),
        getOptimisticState: vi.fn().mockReturnValue({ isOn: true }),
        setErrorReporter: vi.fn(),
      };
      mockProtocolManager.getDevice.mockReturnValue(mockDevice);

      const stateHandler = vi.fn();
      processor.on('state', stateHandler);

      const result = processor.constructCommandPacket(entity, 'on');

      expect(result).toBe(expectedPacket);
      expect(mockDevice.getOptimisticState).toHaveBeenCalledWith('on', undefined);
      expect(stateHandler).toHaveBeenCalledWith({ deviceId: 'light_1', state: { isOn: true } });
    });

    it('should handle virtual switch (optimistic + no command)', () => {
      const entity: EntityConfig = { id: 'virtual_sw', name: 'Virtual', optimistic: true };
      const mockDevice = {
        constructCommand: vi.fn().mockReturnValue(null), // No packet
        getOptimisticState: vi.fn().mockReturnValue({ isOn: true }),
        setErrorReporter: vi.fn(),
      };
      mockProtocolManager.getDevice.mockReturnValue(mockDevice);

      const stateHandler = vi.fn();
      processor.on('state', stateHandler);

      const result = processor.constructCommandPacket(entity, 'on');

      // Should return empty array (virtual success)
      expect(result).toEqual([]);
      expect(stateHandler).toHaveBeenCalledWith({ deviceId: 'virtual_sw', state: { isOn: true } });
    });

    it('should normalize command name (remove command_ prefix)', () => {
      const entity: EntityConfig = { id: 'light_1', name: 'Light' };
      const mockDevice = {
        constructCommand: vi.fn().mockReturnValue([0x01]),
        setErrorReporter: vi.fn(),
      };
      mockProtocolManager.getDevice.mockReturnValue(mockDevice);

      processor.constructCommandPacket(entity, 'command_off');

      expect(mockDevice.constructCommand).toHaveBeenCalledWith('off', undefined, undefined);
    });

    it('should set up error reporter for fallback device', () => {
      const entity: EntityConfig = { id: 'unknown_1', name: 'Unknown' };
      mockProtocolManager.getDevice.mockReturnValue(undefined);

      const mockSetErrorReporter = vi.fn();

      (GenericDevice as any).mockImplementationOnce((ent: any) => ({
        entity: ent,
        constructCommand: vi.fn().mockReturnValue([0x01]),
        setErrorReporter: mockSetErrorReporter,
        getLastError: vi.fn(),
        getOptimisticState: vi.fn(),
      }));

      processor.constructCommandPacket(entity, 'on');

      expect(mockSetErrorReporter).toHaveBeenCalled();

      // Verify callback behavior
      const errorHandler = vi.fn();
      processor.on('entity-error', errorHandler);

      const callback = mockSetErrorReporter.mock.calls[0][0];
      callback({ error: 'test error' });

      expect(errorHandler).toHaveBeenCalledWith({ error: 'test error', portId: undefined });
    });
  });
});
