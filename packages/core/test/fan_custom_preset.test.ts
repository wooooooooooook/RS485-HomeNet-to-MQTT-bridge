import { describe, it, expect } from 'vitest';
import { FanDevice } from '../src/protocol/devices/fan.device.js';
import { ProtocolConfig } from '../src/protocol/types.js';

describe('Fan Preset Mode (CEL)', () => {
    const protocolConfig: ProtocolConfig = {
        packet_defaults: {
            rx_header: [0xf7],
            rx_footer: [0xee],
            tx_header: [0xf7],
            tx_footer: [0xee],
        },
    };

    describe('state_preset_mode (CEL state parsing)', () => {
        it('should parse preset mode from packet using CEL expression', () => {
            const config: any = {
                id: 'test_fan',
                name: 'Test Fan',
                type: 'fan',
                state: {
                    data: [0x30, 0x01, 0x71],
                },
                state_on: {
                    offset: 4,
                    data: [0x01],
                },
                state_off: {
                    offset: 4,
                    data: [0x00],
                },
                preset_modes: ['Auto', 'Sleep', 'Turbo'],
                // CEL expression: byte index 5 in full packet determines preset
                state_preset_mode: `data[5] == 0x01 ? "Auto" : (data[5] == 0x02 ? "Sleep" : "Turbo")`,
            };

            const device = new FanDevice(config, protocolConfig);

            // Test Auto preset (byte 5 = 0x01)
            // Packet: [header=0xf7] [0x30, 0x01, 0x71, 0x01, 0x01, ...] [footer=0xee]
            const packetAuto = [0xf7, 0x30, 0x01, 0x71, 0x01, 0x01, 0x00, 0xee];
            const resultAuto = device.parseData(packetAuto);
            expect(resultAuto).not.toBeNull();
            expect(resultAuto?.preset_mode).toBe('Auto');

            // Test Sleep preset (byte 5 = 0x02)
            const packetSleep = [0xf7, 0x30, 0x01, 0x71, 0x01, 0x02, 0x00, 0xee];
            const resultSleep = device.parseData(packetSleep);
            expect(resultSleep?.preset_mode).toBe('Sleep');

            // Test Turbo preset (byte 5 = anything else, e.g., 0x03)
            const packetTurbo = [0xf7, 0x30, 0x01, 0x71, 0x01, 0x03, 0x00, 0xee];
            const resultTurbo = device.parseData(packetTurbo);
            expect(resultTurbo?.preset_mode).toBe('Turbo');
        });

        it('should parse multiple state fields together', () => {
            const config: any = {
                id: 'test_fan',
                name: 'Test Fan',
                type: 'fan',
                state: {
                    data: [0x30, 0x01, 0x71],
                },
                state_on: {
                    offset: 4,
                    data: [0x01],
                },
                state_off: {
                    offset: 4,
                    data: [0x00],
                },
                preset_modes: ['Low', 'Medium', 'High'],
                state_preset_mode: `data[6] == 0x01 ? "Low" : (data[6] == 0x02 ? "Medium" : "High")`,
            };

            const device = new FanDevice(config, protocolConfig);

            // Packet with state ON (payload[4]=0x01) and preset Medium (data[6]=0x02)
            // Full packet: [header=0xf7, 0x30, 0x01, 0x71, 0x00, 0x01, 0x02, 0x00, 0xee]
            // payload = [0x30, 0x01, 0x71, 0x00, 0x01, 0x02, 0x00] (after header)
            // payload[4] = 0x01 (ON)
            const packet = [0xf7, 0x30, 0x01, 0x71, 0x00, 0x01, 0x02, 0x00, 0xee];
            const result = device.parseData(packet);

            expect(result).not.toBeNull();
            expect(result?.state).toBe('ON');
            expect(result?.preset_mode).toBe('Medium');
        });
    });

    describe('command_preset_mode (CEL command construction)', () => {
        it('should construct command packet for preset mode using CEL expression', () => {
            const config: any = {
                id: 'test_fan',
                name: 'Test Fan',
                type: 'fan',
                state: {
                    data: [0x30, 0x01, 0x71],
                },
                preset_modes: ['Auto', 'Sleep', 'Turbo'],
                // CEL expression: generate packet based on selected preset string (xstr)
                command_preset_mode: `xstr == "Auto" ? [0x30, 0x71, 0x01, 0x12, 0x01] : (xstr == "Sleep" ? [0x30, 0x71, 0x01, 0x12, 0x02] : [0x30, 0x71, 0x01, 0x12, 0x03])`,
            };

            const device = new FanDevice(config, protocolConfig);

            // Test Auto command
            const cmdAuto = device.constructCommand('preset_mode', 'Auto');
            expect(cmdAuto).not.toBeNull();
            // Expected: header + data + footer (no checksum configured)
            expect(cmdAuto).toEqual([0xf7, 0x30, 0x71, 0x01, 0x12, 0x01, 0xee]);

            // Test Sleep command
            const cmdSleep = device.constructCommand('preset_mode', 'Sleep');
            expect(cmdSleep).toEqual([0xf7, 0x30, 0x71, 0x01, 0x12, 0x02, 0xee]);

            // Test Turbo command
            const cmdTurbo = device.constructCommand('preset_mode', 'Turbo');
            expect(cmdTurbo).toEqual([0xf7, 0x30, 0x71, 0x01, 0x12, 0x03, 0xee]);
        });

        it('should handle Korean preset names', () => {
            const config: any = {
                id: 'ventilator',
                name: '환기 팬',
                type: 'fan',
                state: {
                    data: [0x30, 0x01, 0x71],
                },
                preset_modes: ['자동', '수면', '터보'],
                command_preset_mode: `xstr == "자동" ? [0x30, 0x71, 0x01] : (xstr == "수면" ? [0x30, 0x71, 0x02] : [0x30, 0x71, 0x03])`,
            };

            const device = new FanDevice(config, protocolConfig);

            // Test Korean preset names
            const cmd자동 = device.constructCommand('preset_mode', '자동');
            expect(cmd자동).toEqual([0xf7, 0x30, 0x71, 0x01, 0xee]);

            const cmd수면 = device.constructCommand('preset_mode', '수면');
            expect(cmd수면).toEqual([0xf7, 0x30, 0x71, 0x02, 0xee]);

            const cmd터보 = device.constructCommand('preset_mode', '터보');
            expect(cmd터보).toEqual([0xf7, 0x30, 0x71, 0x03, 0xee]);
        });
    });

    describe('Integration: state and command together', () => {
        it('should correctly parse and construct preset modes in a full config', () => {
            const config: any = {
                id: 'ventilator',
                name: 'Ventilator Fan',
                type: 'fan',
                state: {
                    data: [0x30, 0x01, 0x71],
                },
                state_on: {
                    offset: 4,
                    data: [0x01],
                },
                state_off: {
                    offset: 4,
                    data: [0x00],
                },
                command_on: {
                    data: [0x30, 0x71, 0x01, 0x11, 0x01],
                },
                command_off: {
                    data: [0x30, 0x71, 0x01, 0x11, 0x00],
                },
                preset_modes: ['Low', 'Medium', 'High'],
                state_preset_mode: `data[5] == 0x01 ? "Low" : (data[5] == 0x02 ? "Medium" : "High")`,
                command_preset_mode: `xstr == "Low" ? [0x30, 0x71, 0x01, 0x12, 0x01] : (xstr == "Medium" ? [0x30, 0x71, 0x01, 0x12, 0x02] : [0x30, 0x71, 0x01, 0x12, 0x03])`,
            };

            const device = new FanDevice(config, protocolConfig);

            // Parse state: fan ON with Low preset
            const packetLow = [0xf7, 0x30, 0x01, 0x71, 0x01, 0x01, 0xee];
            const stateLow = device.parseData(packetLow);
            expect(stateLow?.state).toBe('ON');
            expect(stateLow?.preset_mode).toBe('Low');

            // Construct command: High preset
            const cmdHigh = device.constructCommand('preset_mode', 'High');
            expect(cmdHigh).toEqual([0xf7, 0x30, 0x71, 0x01, 0x12, 0x03, 0xee]);

            // Construct on/off commands should still work
            const cmdOn = device.constructCommand('on');
            expect(cmdOn).toEqual([0xf7, 0x30, 0x71, 0x01, 0x11, 0x01, 0xee]);

            const cmdOff = device.constructCommand('off');
            expect(cmdOff).toEqual([0xf7, 0x30, 0x71, 0x01, 0x11, 0x00, 0xee]);
        });
    });
});
