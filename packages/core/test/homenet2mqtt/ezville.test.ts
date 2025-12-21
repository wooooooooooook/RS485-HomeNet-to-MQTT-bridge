import { describe, it, expect } from 'vitest';
import { setupTest, processPacket, executeCommand } from './utils';
import { EZVILLE_PACKETS } from '../../../simulator/src/ezville';
import { Buffer } from 'buffer';

describe('HomeNet to MQTT - Ezville Protocol', () => {
  it('should process Ezville packets and publish state', async () => {
    const ctx = await setupTest('ezville.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    // light_1_0 (ON) - Index 4
    processPacket(stateManager, EZVILLE_PACKETS[4]);

    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/light_1_1/state',
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );

    // thermostat 1 (HEAT) - Index 29
    processPacket(stateManager, EZVILLE_PACKETS[29]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/thermostat_1/state',
      expect.stringMatching(/"mode":"heat"/),
      expect.objectContaining({ retain: true }),
    );

    // Gas Valve (OPEN) - Index 40
    processPacket(stateManager, EZVILLE_PACKETS[40]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/gas_valve/state',
      JSON.stringify({ state: 'OPEN' }),
      expect.objectContaining({ retain: true }),
    );

    // outlet_1_1 (ON) - Index 43
    processPacket(stateManager, EZVILLE_PACKETS[43]);
    expect(publishMock).toHaveBeenCalledWith(
      'homenet2mqtt/homedevice1/outlet_1_1/state',
      JSON.stringify({ state: 'ON' }),
      expect.objectContaining({ retain: true }),
    );
  });

  it('should generate command packets', async () => {
    const ctx = await setupTest('ezville.homenet_bridge.yaml');

    // Command ON for light_1_0
    // Data: [0x0e, 0x11, 0x41, 0x03, 0x0f, 0x01, 0x00]
    // Checksum: XOR_ADD (2 bytes) -> A4 0E
    // Header: F7
    await executeCommand(ctx, 'light_1_0', 'on', null);
    const expectedLight = Buffer.from([
      0xf7, 0x0e, 0x11, 0x41, 0x03, 0x0f, 0x01, 0x00, 0xa4, 0x0e,
    ]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedLight);

    // Command Close for gas_valve
    // Data: [0x33, 0x01, 0x81, 0x03, 0x00, 0x05, 0x00]
    // Checksum: XOR_ADD -> 42 F6
    // Header: F7
    await executeCommand(ctx, 'gas_valve', 'close', null);
    const expectedGas = Buffer.from([
      0xf7, 0x33, 0x01, 0x81, 0x03, 0x00, 0x05, 0x00, 0x42, 0xf6,
    ]);
    expect(ctx.mockSerialPort.write).toHaveBeenCalledWith(expectedGas);
  });
});
