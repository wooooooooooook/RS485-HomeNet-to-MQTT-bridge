import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HomeNetBridge } from '../src/service/bridge.service.js';
import { HomenetBridgeConfig } from '../src/config/types.js';

// Mocks
vi.mock('mqtt', () => ({
  default: {
    connect: () => ({
      publish: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn(),
      end: vi.fn(),
      connected: true,
      options: {},
      removeAllListeners: vi.fn(),
    }),
  },
}));

vi.mock('../src/state/state-manager.js', () => ({
  StateManager: vi.fn().mockImplementation(() => ({
    processIncomingData: vi.fn(),
    getLightState: vi.fn(),
    getClimateState: vi.fn(),
    getAllStates: vi.fn(),
    getEntityState: vi.fn(),
  })),
}));

vi.mock('../src/utils/logger.js', () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
    }
}));

describe('HomeNetBridge.constructCustomPacket', () => {
  let bridge: HomeNetBridge;

  const mockSerialFactory = vi.fn().mockResolvedValue({
    on: vi.fn(),
    write: vi.fn(),
    destroy: vi.fn(),
    removeAllListeners: vi.fn(),
  } as any);

  const baseConfig: HomenetBridgeConfig = {
    serial: {
      portId: 'test',
      path: '/dev/test',
      baud_rate: 9600,
      data_bits: 8,
      parity: 'none',
      stop_bits: 1,
    },
    packet_defaults: {
      // Default to nothing for base, we will override in tests or set it up
    },
  };

  const createBridge = async (configOverride: HomenetBridgeConfig) => {
    const b = new HomeNetBridge({
      configPath: 'dummy.yaml',
      mqttUrl: 'mqtt://localhost',
      configOverride,
      serialFactory: mockSerialFactory,
    });
    // Start initializes config and connects to serial port
    await b.start();
    return b;
  };

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
    }
    vi.clearAllMocks();
  });

  it('should fail if bridge is not initialized', () => {
    bridge = new HomeNetBridge({
      configPath: 'dummy.yaml',
      mqttUrl: 'mqtt://localhost',
    });
    const result = bridge.constructCustomPacket('0102', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('Bridge not initialized');
  });

  it('should construct a simple packet with valid hex', async () => {
    bridge = await createBridge(baseConfig);
    const result = bridge.constructCustomPacket('01 02 03', {});
    expect(result.success).toBe(true);
    expect(result.packet).toBe('010203');
  });

  it('should handle invalid hex string length', async () => {
    bridge = await createBridge(baseConfig);
    const result = bridge.constructCustomPacket('01020', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid hex string length');
  });

  it('should handle hex string with non-hex characters (cleaned)', async () => {
    bridge = await createBridge(baseConfig);
    // "01ZZ02" -> "0102" -> valid
    const result = bridge.constructCustomPacket('01ZZ02', {});
    expect(result.success).toBe(true);
    expect(result.packet).toBe('0102');
  });

  it('should apply header and footer when configured and requested', async () => {
    const config = {
      ...baseConfig,
      packet_defaults: {
        rx_header: [0xAA],
        rx_footer: [0x55],
      },
    };
    bridge = await createBridge(config);

    // Request header and footer
    const result = bridge.constructCustomPacket('0102', { header: true, footer: true });
    expect(result.success).toBe(true);
    expect(result.packet).toBe('AA010255');
  });

  it('should not apply header/footer if not requested even if configured', async () => {
    const config = {
      ...baseConfig,
      packet_defaults: {
        rx_header: [0xAA],
        rx_footer: [0x55],
      },
    };
    bridge = await createBridge(config);

    const result = bridge.constructCustomPacket('0102', { header: false, footer: false });
    expect(result.success).toBe(true);
    expect(result.packet).toBe('0102');
  });

  it('should calculate 1-byte checksum (add)', async () => {
    const config = {
      ...baseConfig,
      packet_defaults: {
        rx_header: [0x10],
        rx_checksum: 'add',
      },
    } as HomenetBridgeConfig;
    bridge = await createBridge(config);

    // Header: 10
    // Data: 20
    // Checksum: (10 + 20) & FF = 30
    const result = bridge.constructCustomPacket('20', { header: true, checksum: true });
    expect(result.success).toBe(true);
    expect(result.packet).toBe('102030');
  });

  it('should calculate 1-byte checksum (add_no_header)', async () => {
    const config = {
      ...baseConfig,
      packet_defaults: {
        rx_header: [0x10],
        rx_checksum: 'add_no_header',
      },
    } as HomenetBridgeConfig;
    bridge = await createBridge(config);

    // Header: 10
    // Data: 20
    // Checksum: (20) & FF = 20
    // Result: 10 20 20
    const result = bridge.constructCustomPacket('20', { header: true, checksum: true });
    expect(result.success).toBe(true);
    expect(result.packet).toBe('102020');
  });

  it('should calculate 1-byte checksum (xor)', async () => {
    const config = {
      ...baseConfig,
      packet_defaults: {
        rx_header: [0xFF],
        rx_checksum: 'xor',
      },
    } as HomenetBridgeConfig;
    bridge = await createBridge(config);

    // Header: FF
    // Data: 01
    // Checksum: FF ^ 01 = FE
    // Result: FF 01 FE
    const result = bridge.constructCustomPacket('01', { header: true, checksum: true });
    expect(result.success).toBe(true);
    expect(result.packet).toBe('FF01FE');
  });

  it('should calculate 1-byte checksum (xor_no_header)', async () => {
    const config = {
      ...baseConfig,
      packet_defaults: {
        rx_header: [0xFF],
        rx_checksum: 'xor_no_header',
      },
    } as HomenetBridgeConfig;
    bridge = await createBridge(config);

    // Header: FF
    // Data: 01
    // Checksum: 01
    // Result: FF 01 01
    const result = bridge.constructCustomPacket('01', { header: true, checksum: true });
    expect(result.success).toBe(true);
    expect(result.packet).toBe('FF0101');
  });

  it('should calculate 2-byte checksum (xor_add)', async () => {
    const config = {
      ...baseConfig,
      packet_defaults: {
         rx_checksum2: 'xor_add',
      },
    } as HomenetBridgeConfig;
    bridge = await createBridge(config);

    // Data: 01 02
    // Result: 01 02 03 06
    const result = bridge.constructCustomPacket('0102', { checksum: true });
    expect(result.success).toBe(true);
    expect(result.packet).toBe('01020306');
  });

  it('should ignore checksum if not requested', async () => {
     const config = {
      ...baseConfig,
      packet_defaults: {
        rx_checksum: 'xor',
      },
    } as HomenetBridgeConfig;
    bridge = await createBridge(config);

    const result = bridge.constructCustomPacket('01', { checksum: false });
    expect(result.success).toBe(true);
    expect(result.packet).toBe('01');
  });

  it('should handle complex case with header, footer and checksum', async () => {
      const config = {
        ...baseConfig,
        packet_defaults: {
            rx_header: [0xAA],
            rx_footer: [0x55],
            rx_checksum: 'xor'
        }
      } as HomenetBridgeConfig;
      bridge = await createBridge(config);

      // Header: AA
      // Data: 01 02
      // Checksum: AA ^ 01 ^ 02 = A9
      // Footer: 55
      // Result: AA 01 02 A9 55

      const result = bridge.constructCustomPacket('0102', { header: true, footer: true, checksum: true });
      expect(result.success).toBe(true);
      expect(result.packet).toBe('AA0102A955');
  });
});
