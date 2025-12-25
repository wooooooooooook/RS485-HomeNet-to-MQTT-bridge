import { describe, it, expect } from 'vitest';

describe('Heater 4 Packet Matching', () => {
  it('should match heater_4 packet with mask', () => {
    const packet = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3d];
    const stateData = [0x80, 0x00, 0x04];
    const stateMask = [0xf9, 0x00, 0xff];

    for (let i = 0; i < stateData.length; i++) {
      const packetByte = packet[i];
      const expectedByte = stateData[i];
      const mask = stateMask[i];
      const maskedPacket = packetByte & mask;
      const maskedExpected = expectedByte & mask;

      expect(maskedPacket).toBe(maskedExpected);
    }
  });

  it('should decode BCD temperature values', () => {
    const packet = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3d];

    // state_temperature_current: offset: 3
    const currentTempByte = packet[3]; // 0x22
    const currentTemp = (currentTempByte >> 4) * 10 + (currentTempByte & 0x0f);
    expect(currentTemp).toBe(22);

    // state_temperature_target: offset: 4
    const targetTempByte = packet[4]; // 0x15
    const targetTemp = (targetTempByte >> 4) * 10 + (targetTempByte & 0x0f);
    expect(targetTemp).toBe(15);
  });

  it('should determine heater state', () => {
    const packet = [0x82, 0x80, 0x04, 0x22, 0x15, 0x00, 0x00, 0x3d];

    // state_off: offset: 1, data: [0x80]
    const byte1 = packet[1]; // 0x80
    const isOff = byte1 === 0x80;
    expect(isOff).toBe(true);

    // state_heat: offset: 1, data: [0x00], mask: [0x0F], inverted: true
    const heatMasked = byte1 & 0x0f; // 0x80 & 0x0F = 0x00
    const isHeat = heatMasked !== 0x00; // inverted: true means NOT equal to 0x00
    expect(isHeat).toBe(false);
  });
});
