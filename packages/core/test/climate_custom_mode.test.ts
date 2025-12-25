import { describe, it, expect } from 'vitest';
import { ClimateDevice } from '../src/protocol/devices/climate.device.js';
import { ProtocolConfig } from '../src/protocol/types.js';

describe('Climate Custom Mode (CEL)', () => {
    const protocolConfig: ProtocolConfig = {
        packet_defaults: {
            rx_header: [0xf7],
            rx_footer: [0xee],
            tx_header: [0xf7],
            tx_footer: [0xee],
        },
    };

    describe('state_custom_fan (CEL state parsing)', () => {
        it('should parse custom fan mode from packet using CEL expression', () => {
            const config: any = {
                id: 'test_ac',
                name: 'Test AC',
                type: 'climate',
                state: {
                    data: [0x20, 0x10],
                },
                custom_fan_mode: ['Turbo', 'Nature', 'Sleep'],
                // CEL expression: byte index 6 in full packet (header at 0) determines mode
                state_custom_fan: `data[6] == 0x03 ? "Turbo" : (data[6] == 0x02 ? "Nature" : "Sleep")`,
            };

            const device = new ClimateDevice(config, protocolConfig);

            // Test Turbo mode (byte 5 = 0x03)
            // Packet: [header] [0x20, 0x10, 0x00, 0x00, 0x00, 0x03, ...] [footer]
            const packetTurbo = [0xf7, 0x20, 0x10, 0x00, 0x00, 0x00, 0x03, 0x00, 0xee];
            const resultTurbo = device.parseData(packetTurbo);
            expect(resultTurbo).not.toBeNull();
            expect(resultTurbo?.custom_fan).toBe('Turbo');

            // Test Nature mode (byte 5 = 0x02)
            const packetNature = [0xf7, 0x20, 0x10, 0x00, 0x00, 0x00, 0x02, 0x00, 0xee];
            const resultNature = device.parseData(packetNature);
            expect(resultNature?.custom_fan).toBe('Nature');

            // Test Sleep mode (byte 5 = anything else, e.g., 0x01)
            const packetSleep = [0xf7, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0xee];
            const resultSleep = device.parseData(packetSleep);
            expect(resultSleep?.custom_fan).toBe('Sleep');
        });

        it('should parse custom preset mode from packet using CEL expression', () => {
            const config: any = {
                id: 'test_ac',
                name: 'Test AC',
                type: 'climate',
                state: {
                    data: [0x20, 0x10],
                },
                custom_preset: ['Eco', 'Comfort', 'Boost'],
                // CEL expression: byte index 7 in full packet determines preset
                state_custom_preset: `data[7] == 0x01 ? "Eco" : (data[7] == 0x02 ? "Comfort" : "Boost")`,
            };

            const device = new ClimateDevice(config, protocolConfig);

            // Test Eco preset
            const packetEco = [0xf7, 0x20, 0x10, 0x00, 0x00, 0x00, 0x00, 0x01, 0xee];
            const resultEco = device.parseData(packetEco);
            expect(resultEco?.custom_preset).toBe('Eco');

            // Test Comfort preset
            const packetComfort = [0xf7, 0x20, 0x10, 0x00, 0x00, 0x00, 0x00, 0x02, 0xee];
            const resultComfort = device.parseData(packetComfort);
            expect(resultComfort?.custom_preset).toBe('Comfort');

            // Test Boost preset
            const packetBoost = [0xf7, 0x20, 0x10, 0x00, 0x00, 0x00, 0x00, 0x03, 0xee];
            const resultBoost = device.parseData(packetBoost);
            expect(resultBoost?.custom_preset).toBe('Boost');
        });
    });

    describe('command_custom_fan (CEL command construction)', () => {
        it('should construct command packet for custom fan mode using CEL expression', () => {
            const config: any = {
                id: 'test_ac',
                name: 'Test AC',
                type: 'climate',
                state: {
                    data: [0x20, 0x10],
                },
                custom_fan_mode: ['Turbo', 'Nature', 'Sleep'],
                // CEL expression: generate packet based on selected mode string (xstr)
                command_custom_fan: `xstr == "Turbo" ? [0x20, 0x11, 0x03] : (xstr == "Nature" ? [0x20, 0x11, 0x02] : [0x20, 0x11, 0x01])`,
            };

            const device = new ClimateDevice(config, protocolConfig);

            // Test Turbo command
            const cmdTurbo = device.constructCommand('custom_fan', 'Turbo');
            expect(cmdTurbo).not.toBeNull();
            // Expected: header + data + footer (no checksum configured)
            expect(cmdTurbo).toEqual([0xf7, 0x20, 0x11, 0x03, 0xee]);

            // Test Nature command
            const cmdNature = device.constructCommand('custom_fan', 'Nature');
            expect(cmdNature).toEqual([0xf7, 0x20, 0x11, 0x02, 0xee]);

            // Test Sleep command
            const cmdSleep = device.constructCommand('custom_fan', 'Sleep');
            expect(cmdSleep).toEqual([0xf7, 0x20, 0x11, 0x01, 0xee]);
        });

        it('should construct command packet for custom preset using CEL expression', () => {
            const config: any = {
                id: 'test_ac',
                name: 'Test AC',
                type: 'climate',
                state: {
                    data: [0x20, 0x10],
                },
                custom_preset: ['Eco', 'Comfort', 'Boost'],
                command_custom_preset: `xstr == "Eco" ? [0x20, 0x12, 0x01] : (xstr == "Comfort" ? [0x20, 0x12, 0x02] : [0x20, 0x12, 0x03])`,
            };

            const device = new ClimateDevice(config, protocolConfig);

            // Test Eco command
            const cmdEco = device.constructCommand('custom_preset', 'Eco');
            expect(cmdEco).toEqual([0xf7, 0x20, 0x12, 0x01, 0xee]);

            // Test Comfort command
            const cmdComfort = device.constructCommand('custom_preset', 'Comfort');
            expect(cmdComfort).toEqual([0xf7, 0x20, 0x12, 0x02, 0xee]);

            // Test Boost command
            const cmdBoost = device.constructCommand('custom_preset', 'Boost');
            expect(cmdBoost).toEqual([0xf7, 0x20, 0x12, 0x03, 0xee]);
        });
    });

    describe('Integration: state and command together', () => {
        it('should correctly parse and construct custom modes in a full config', () => {
            const config: any = {
                id: 'bedroom_ac',
                name: 'Bedroom AC',
                type: 'climate',
                state: {
                    data: [0x30, 0x01],
                },
                custom_fan_mode: ['Auto', 'Low', 'High'],
                state_custom_fan: `data[4] == 0x00 ? "Auto" : (data[4] == 0x01 ? "Low" : "High")`,
                command_custom_fan: `xstr == "Auto" ? [0x30, 0x02, 0x00] : (xstr == "Low" ? [0x30, 0x02, 0x01] : [0x30, 0x02, 0x02])`,
            };

            const device = new ClimateDevice(config, protocolConfig);

            // Parse state: Auto fan mode (data[4] = 0x00, which is index 4 in the full packet)
            // Packet: [header=0xf7, 0x30, 0x01, 0x00, 0x00, footer=0xee] => data[4] = 0x00
            const packetAuto = [0xf7, 0x30, 0x01, 0x00, 0x00, 0xee];
            const stateAuto = device.parseData(packetAuto);
            expect(stateAuto?.custom_fan).toBe('Auto');

            // Construct command: High fan mode
            const cmdHigh = device.constructCommand('custom_fan', 'High');
            expect(cmdHigh).toEqual([0xf7, 0x30, 0x02, 0x02, 0xee]);
        });
    });
});
