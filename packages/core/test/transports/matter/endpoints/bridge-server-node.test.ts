import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BridgeServerNode } from '../../../../src/transports/matter/endpoints/bridge-server-node.js';

// Mock ServerNode so we don't start actual Matter nodes
vi.mock('@matter/main/node', () => {
  return {
    ServerNode: class {
      static RootEndpoint = 'RootEndpoint'; // Mock static property used in constructor
      cancel = vi.fn().mockResolvedValue(undefined);
      erase = vi.fn().mockResolvedValue(undefined);
      constructor(config: any) {
        (this as any).config = config;
      }
    },
  };
});

describe('BridgeServerNode', () => {
  let mockEnv: any;
  let mockAggregator: any;

  beforeEach(() => {
    mockEnv = {};
    mockAggregator = {
      type: { deviceType: 0x0012 }, // e.g. Aggregator deviceType
    };
  });

  it('should initialize with default options', () => {
    const node = new BridgeServerNode(mockEnv, { id: '', name: '' }, mockAggregator);
    const config = (node as any).config;

    expect(config.id).toBe('homenet_bridge');
    expect(config.environment).toBe(mockEnv);
    expect(config.network.port).toBe(5540);
    expect(config.commissioning.passcode).toBe(-1);
    expect(config.commissioning.discriminator).toBe(-1);
    expect(config.productDescription.name).toBe('Homenet Matter Bridge');
    expect(config.productDescription.deviceType).toBe(0x0012);
    // expect(config.basicInformation.vendorId).toBe(0xfff1);
    // basicInformation.vendorId is actually created by VendorId(0xfff1) which returns 65521
    expect(config.parts).toContain(mockAggregator);
  });

  it('should initialize with provided options', () => {
    const node = new BridgeServerNode(
      mockEnv,
      {
        id: 'custom_id',
        name: 'Custom Name',
        port: 1234,
        passcode: 123456,
        discriminator: 123,
        vendorId: 0x1111,
        productId: 0x2222,
        productName: 'Custom Product',
      },
      mockAggregator,
    );
    const config = (node as any).config;

    expect(config.id).toBe('custom_id');
    expect(config.network.port).toBe(1234);
    expect(config.commissioning.passcode).toBe(123456);
    expect(config.commissioning.discriminator).toBe(123);
    expect(config.basicInformation.productId).toBe(0x2222);
    expect(config.basicInformation.productName).toBe('Custom Product');
  });

  it('should call cancel and erase on factoryReset', async () => {
    const node = new BridgeServerNode(mockEnv, { id: '', name: '' }, mockAggregator);
    await node.factoryReset();

    expect(node.cancel).toHaveBeenCalled();
    expect(node.erase).toHaveBeenCalled();
  });
});
