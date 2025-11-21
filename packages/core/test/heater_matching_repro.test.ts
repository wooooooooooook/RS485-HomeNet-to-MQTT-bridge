import { describe, it, expect, vi } from 'vitest';
import { ProtocolManager } from '../src/protocol/protocol-manager.js';
import { ClimateDevice } from '../src/protocol/devices/climate.device.js';
import { ProtocolConfig, DeviceConfig } from '../src/protocol/types.js';

describe('Heater Matching Reproduction', () => {
    it('should match Room 2 Heater packet', () => {
        const config: ProtocolConfig = {
            packet_defaults: {
                rx_header: [0xB0],
                rx_checksum: 'samsung_rx'
            }
        };

        const manager = new ProtocolManager(config);

        // Config from samsung_sds.homenet_bridge.yaml for Room 2 Heater
        const deviceConfig: DeviceConfig = {
            id: 'heater_2',
            name: 'Room 2 Heater',
            state: {
                data: [0x7C, 0x03]
            },
            state_temperature_current: {
                offset: 4,
                length: 1
            },
            state_heat: {
                offset: 2,
                data: [0x01],
                mask: [0x01]
            }
            // Add other necessary properties for ClimateDevice if needed
            // For matching, state is the most important
        } as any; // Cast to any to avoid full interface implementation for test

        const device = new ClimateDevice(deviceConfig, config);
        manager.registerDevice(device);

        const spy = vi.fn();
        manager.on('state', spy);

        // Packet: B0 7C 03 00 14 16 FF 32
        const packet = [0xB0, 0x7C, 0x03, 0x00, 0x14, 0x16, 0xFF, 0x32];

        // Manually trigger processPacket (which is private, so we use handleIncomingByte loop or mock)
        // But ProtocolManager.processPacket is private.
        // We can use handleIncomingByte if we want to test the full flow, 
        // but we already know parsing works.
        // Let's try to call device.parseData directly to isolate the issue.

        const updates = device.parseData(packet);

        expect(updates).not.toBeNull();
        // If it matches, it should return some state
    });
});
