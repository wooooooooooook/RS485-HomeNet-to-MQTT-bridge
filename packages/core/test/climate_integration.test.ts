import { describe, it, expect } from 'vitest';
import { ClimateDevice } from '../src/protocol/devices/climate.device.js';
import { ProtocolConfig } from '../src/protocol/types.js';

describe('ClimateDevice Integration Test', () => {
    it('should parse heater_4 packet correctly', () => {
        const heater4Config = {
            id: 'heater_4',
            name: 'Heater 4',
            state: {
                data: [0x80, 0x00, 0x04],
                mask: [0xF9, 0x00, 0xFF]
            },
            state_temperature_current: {
                offset: 3,
                signed: false,
                decode: 'bcd'
            },
            state_temperature_target: {
                offset: 4,
                signed: false,
                decode: 'bcd'
            },
            state_off: {
                offset: 1,
                data: [0x80]
            },
            state_heat: {
                offset: 1,
                data: [0x00],
                mask: [0x0F],
                inverted: true
            }
        };

        const protocolConfig: ProtocolConfig = {
            packet_defaults: {
                rx_length: 8,
                rx_checksum: 'add'
            }
        };

        const device = new ClimateDevice(heater4Config as any, protocolConfig);

        const packet = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3D];

        console.log('Testing packet:', packet.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
        console.log('Device ID:', device.getId());
        console.log('Device Name:', device.getName());

        // Test if packet matches
        const matches = device.matchesPacket(packet);
        console.log('Packet matches:', matches);
        expect(matches).toBe(true);

        // Test parsing
        const result = device.parseData(packet);
        console.log('Parse result:', result);

        expect(result).not.toBeNull();
        expect(result?.current_temperature).toBe(22);
        expect(result?.target_temperature).toBe(15);
        expect(result?.mode).toBe('off');
    });

    it('should handle all user-reported heater packets', () => {
        const heaterConfigs = [
            { id: 'heater_1', state: { data: [0x80, 0x00, 0x01], mask: [0xF9, 0x00, 0xFF] } },
            { id: 'heater_2', state: { data: [0x80, 0x00, 0x02], mask: [0xF9, 0x00, 0xFF] } },
            { id: 'heater_3', state: { data: [0x80, 0x00, 0x03], mask: [0xF9, 0x00, 0xFF] } },
            { id: 'heater_4', state: { data: [0x80, 0x00, 0x04], mask: [0xF9, 0x00, 0xFF] } },
        ];

        const packets = [
            { packet: [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3D], expectedDevice: 'heater_4' },
            { packet: [0x82, 0x80, 0x03, 0x23, 0x20, 0x00, 0x00, 0x48], expectedDevice: 'heater_3' },
            { packet: [0x82, 0x81, 0x02, 0x24, 0x15, 0x00, 0x00, 0x3E], expectedDevice: 'heater_2' },
            { packet: [0x82, 0x81, 0x01, 0x24, 0x15, 0x00, 0x00, 0x3D], expectedDevice: 'heater_1' },
        ];

        const protocolConfig: ProtocolConfig = {
            packet_defaults: {
                rx_length: 8,
                rx_checksum: 'add'
            }
        };

        for (const { packet, expectedDevice } of packets) {
            console.log(`\nTesting packet: ${packet.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);

            let matched = false;
            for (const config of heaterConfigs) {
                const device = new ClimateDevice({
                    ...config,
                    name: config.id,
                    state_temperature_current: { offset: 3, signed: false, decode: 'bcd' },
                    state_temperature_target: { offset: 4, signed: false, decode: 'bcd' },
                } as any, protocolConfig);

                if (device.matchesPacket(packet)) {
                    console.log(`  Matched: ${device.getId()}`);
                    expect(device.getId()).toBe(expectedDevice);
                    matched = true;
                    break;
                }
            }

            expect(matched).toBe(true);
        }
    });
});
