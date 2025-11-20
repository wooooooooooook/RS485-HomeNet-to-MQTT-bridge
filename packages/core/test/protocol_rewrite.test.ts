import { describe, it, expect, vi } from 'vitest';
import { PacketParser } from '../src/protocol/packet-parser.js';
import { ProtocolManager } from '../src/protocol/protocol-manager.js';
import { GenericDevice } from '../src/protocol/devices/generic.device.js';
import { ProtocolConfig, DeviceConfig } from '../src/protocol/types.js';

describe('PacketParser', () => {
    it('should parse a simple packet with header and footer', () => {
        const parser = new PacketParser({
            rx_header: [0x02],
            rx_footer: [0x03],
            rx_checksum: 'none'
        });

        expect(parser.parse(0x02)).toBeNull();
        expect(parser.parse(0x01)).toBeNull();
        const packet = parser.parse(0x03);
        expect(packet).toEqual([0x02, 0x01, 0x03]);
    });

    it('should handle checksum (add)', () => {
        const parser = new PacketParser({
            rx_header: [0xAA],
            rx_footer: [],
            rx_checksum: 'add',
            rx_length: 3
        });

        // Packet: AA 01 AB (AA+01 = AB)
        expect(parser.parse(0xAA)).toBeNull();
        expect(parser.parse(0x01)).toBeNull();
        const packet = parser.parse(0xAB);
        expect(packet).toEqual([0xAA, 0x01, 0xAB]);
    });
});

describe('ProtocolManager', () => {
    it('should emit state events when device parses data', () => {
        const config: ProtocolConfig = {
            packet_defaults: {
                rx_header: [0x02],
                rx_footer: [0x03],
                rx_checksum: 'none'
            }
        };
        const manager = new ProtocolManager(config);
        const deviceConfig: DeviceConfig = { id: 'test_dev', name: 'Test Device' };
        const device = new GenericDevice(deviceConfig, config);

        // Mock parseData
        device.parseData = vi.fn().mockReturnValue({ on: true });
        manager.registerDevice(device);

        const spy = vi.fn();
        manager.on('state', spy);

        manager.handleIncomingByte(0x02);
        manager.handleIncomingByte(0x01);
        manager.handleIncomingByte(0x03);

        expect(spy).toHaveBeenCalledWith({
            deviceId: 'test_dev',
            state: { on: true }
        });
    });
});
