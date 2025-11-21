import { describe, it, expect } from 'vitest';

describe('Heater 4 Packet Matching', () => {
    it('should match heater_4 packet with mask', () => {
        const packet = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3D];
        const stateData = [0x80, 0x00, 0x04];
        const stateMask = [0xF9, 0x00, 0xFF];

        console.log('Packet:', packet.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
        console.log('State data:', stateData.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
        console.log('State mask:', stateMask.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));

        for (let i = 0; i < stateData.length; i++) {
            const packetByte = packet[i];
            const expectedByte = stateData[i];
            const mask = stateMask[i];
            const maskedPacket = packetByte & mask;
            const maskedExpected = expectedByte & mask;

            console.log(`  [${i}] packet: 0x${packetByte.toString(16).padStart(2, '0')} & 0x${mask.toString(16).padStart(2, '0')} = 0x${maskedPacket.toString(16).padStart(2, '0')}, expected: 0x${maskedExpected.toString(16).padStart(2, '0')}, match: ${maskedPacket === maskedExpected}`);

            expect(maskedPacket).toBe(maskedExpected);
        }
    });

    it('should decode BCD temperature values', () => {
        const packet = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3D];

        // state_temperature_current: offset: 3
        const currentTempByte = packet[3]; // 0x22
        const currentTemp = (currentTempByte >> 4) * 10 + (currentTempByte & 0x0F);
        console.log(`Current temp: 0x${currentTempByte.toString(16)} -> ${currentTemp}°C`);
        expect(currentTemp).toBe(22);

        // state_temperature_target: offset: 4
        const targetTempByte = packet[4]; // 0x15
        const targetTemp = (targetTempByte >> 4) * 10 + (targetTempByte & 0x0F);
        console.log(`Target temp: 0x${targetTempByte.toString(16)} -> ${targetTemp}°C`);
        expect(targetTemp).toBe(15);
    });

    it('should determine heater state', () => {
        const packet = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3D];

        // state_off: offset: 1, data: [0x80]
        const byte1 = packet[1]; // 0x80
        const isOff = byte1 === 0x80;
        console.log(`Byte[1]: 0x${byte1.toString(16)}, isOff: ${isOff}`);
        expect(isOff).toBe(true);

        // state_heat: offset: 1, data: [0x00], mask: [0x0F], inverted: true
        const heatMasked = byte1 & 0x0F; // 0x80 & 0x0F = 0x00
        const isHeat = heatMasked !== 0x00; // inverted: true means NOT equal to 0x00
        console.log(`Byte[1] & 0x0F: 0x${heatMasked.toString(16)}, isHeat (inverted): ${isHeat}`);
        expect(isHeat).toBe(false);
    });
});
