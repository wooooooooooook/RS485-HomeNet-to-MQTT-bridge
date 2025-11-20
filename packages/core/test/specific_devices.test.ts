import { describe, it, expect } from 'vitest';
import { PacketProcessor } from '../src/protocol/packet-processor.js';
import { HomenetBridgeConfig } from '../src/config/types.js';
import { LightDevice } from '../src/protocol/devices/light.device.js';
import { ClimateDevice } from '../src/protocol/devices/climate.device.js';

describe('Specific Devices Integration', () => {
    const mockConfig: HomenetBridgeConfig = {
        uart: { baud_rate: 9600 },
        packet_defaults: { rx_length: 5 },
        light: [
            {
                name: 'Test Light',
                state_on: { offset: 1, data: [0x01] },
                state_off: { offset: 1, data: [0x00] },
                command_on: { data: [0x01, 0x01] },
                command_off: { data: [0x01, 0x00] }
            }
        ],
        climate: [
            {
                name: 'Test Climate',
                state_temperature_current: { offset: 1, decode: 'bcd' },
                state_temperature_target: { offset: 2, decode: 'bcd' },
                state_off: { offset: 0, data: [0x80] },
                state_heat: { offset: 0, data: [0x81] }
            }
        ]
    };

    const mockStateProvider = {
        getLightState: () => undefined,
        getClimateState: () => undefined
    };

    it('should instantiate correct device classes', () => {
        const processor = new PacketProcessor(mockConfig, mockStateProvider);
        const devices = (processor['protocolManager'] as any).devices;

        expect(devices.length).toBe(2);
        expect(devices[0]).toBeInstanceOf(LightDevice);
        expect(devices[1]).toBeInstanceOf(ClimateDevice);
    });

    it('should parse light state correctly', () => {
        const processor = new PacketProcessor(mockConfig, mockStateProvider);
        const devices = (processor['protocolManager'] as any).devices;
        const light = devices[0] as LightDevice;

        const packetOn = [0xA0, 0x01, 0x00, 0x00, 0x00];
        expect(light.parseData(packetOn)).toEqual({ state: 'ON' });

        const packetOff = [0xA0, 0x00, 0x00, 0x00, 0x00];
        expect(light.parseData(packetOff)).toEqual({ state: 'OFF' });
    });

    it('should parse climate state correctly', () => {
        const processor = new PacketProcessor(mockConfig, mockStateProvider);
        const devices = (processor['protocolManager'] as any).devices;
        const climate = devices[1] as ClimateDevice;

        // Packet: [Mode, CurrentTemp(BCD), TargetTemp(BCD), ...]
        // 0x81 (Heat), 0x25 (25C), 0x30 (30C)
        const packet = [0x81, 0x25, 0x30, 0x00, 0x00];

        const parsed = climate.parseData(packet);
        expect(parsed).toEqual({
            mode: 'heat',
            current_temperature: 25,
            target_temperature: 30
        });
    });
});
