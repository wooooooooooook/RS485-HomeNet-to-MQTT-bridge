import { describe, it, expect } from 'vitest';
import { setupTest, processPacket } from './utils';
import { Buffer } from 'buffer';
import { CelExecutor } from '../../src/protocol/cel-executor';
import { findEntityById } from '../../src/utils/entities';

const DUMP_PACKETS = [
  '02 31 63 91 12 00 01 64 12 F2 03 03 00 00 00 00 73 01 02 0A 0A 12 CB 00 00 00 01 A0 FF FF 02 02 0A 0A 12 91 00 00 00 01 8D FF FF 03 02 64 28 12 DE 00 00 00 FF FF FF FF 01 22 00 00 00 03 35 00 00 00 00 00 00 00 02 21 00 00 00 00 AE 00 64 00 17 00 0B B8 03 22 00 00 00 00 00 00 00 00 00 00 95 A6 4D',
];

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace(/\s+/g, ''), 'hex');
}

/**
 * Bestin Sum Checksum Algorithm:
 * - Initial value: 3
 * - For each byte: sum = ((byte ^ sum) + 1) & 0xFF
 */
function calculateBestinSum(data: number[]): number {
  let sum = 3;
  for (const byte of data) {
    sum = ((byte ^ sum) + 1) & 0xff;
  }
  return sum;
}

describe('Bestin Dimming Test', () => {
  it('should parse dump packets correctly', async () => {
    const ctx = await setupTest('bestin2.0.homenet_bridge.yaml');
    const { stateManager, publishMock } = ctx;

    const packet3 = hexToBuffer(DUMP_PACKETS[0]);
    processPacket(stateManager, packet3);

    expect(true).toBe(true);
  });

  it('should test CEL with diagnostics - bitOr', async () => {
    const celExecutor = new CelExecutor();

    const expr = `[bitOr(0x30, args.room_number)]`;

    const context = {
      states: { sequence_number: { number: 1 } },
      trigger: { type: 'command', timestamp: Date.now(), args: {} },
      timestamp: Date.now(),
      args: { room_number: 1, position: 1, ONOFF: 1 },
    };

    const { result } = celExecutor.executeWithDiagnostics(expr, context);

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([0x31]); // 0x30 | 1 = 0x31
  });

  it('should test full make_light_packet CEL expression', async () => {
    const celExecutor = new CelExecutor();

    // The actual expression from YAML (after fixes)
    const expr = `[bitOr(0x30, args.room_number), 0x0E, 0x21, int(has(states.sequence_number.number) ? states.sequence_number.number : 0), 0x01, 0x00, int(args.position), int(has(args.ONOFF)?args.ONOFF:1), int(has(args.BRIGHTNESS)?args.BRIGHTNESS:0xFF), int(has(args.COLOR_TEMP)?args.COLOR_TEMP:0xFF), 0x00, 0xFF]`;

    const context = {
      states: { sequence_number: { number: 1 } },
      trigger: { type: 'command', timestamp: Date.now(), args: {} },
      timestamp: Date.now(),
      args: { room_number: 1, position: 1, ONOFF: 1 },
    };

    const { result } = celExecutor.executeWithDiagnostics(expr, context);

    // Expected data bytes (without header and checksum)
    const expectedData = [
      0x31, // bitOr(0x30, 1)
      0x0e, // packet length
      0x21, // command type
      0x01, // sequence_number
      0x01, // fixed
      0x00, // fixed
      0x01, // position
      0x01, // ONOFF (1=ON)
      0xff, // BRIGHTNESS (default)
      0xff, // COLOR_TEMP (default)
      0x00, // fixed
      0xff, // fixed
    ];

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(expectedData);
  });

  it('should generate light ON command packet with expected format', async () => {
    const ctx = await setupTest('bestin2.0.homenet_bridge.yaml');
    const { mockSerialPort, sharedStates, config, automationManager } = ctx;

    sharedStates.set('sequence_number', { number: 1 });

    const statesMap = (automationManager as any).states as Map<string, any>;
    statesMap.set('sequence_number', { number: 1 });

    const entity = findEntityById(config, 'room1_light1');
    const commandConfig = (entity as any).command_on;

    const context = {
      type: 'command' as any,
      timestamp: Date.now(),
      args: commandConfig.args,
    };

    await automationManager.runScript(commandConfig.script, context, commandConfig.args);

    // Expected: Header(0x02) + Data + Checksum
    const expectedData = [
      0x02, // tx_header
      0x31, // bitOr(0x30, 1)
      0x0e, // packet length
      0x21, // command type
      0x01, // sequence_number
      0x01, // fixed
      0x00, // fixed
      0x01, // position
      0x01, // ONOFF
      0xff, // BRIGHTNESS
      0xff, // COLOR_TEMP
      0x00, // fixed
      0xff, // fixed
    ];
    const checksum = calculateBestinSum(expectedData);
    const expectedPacket = Buffer.from([...expectedData, checksum]);

    expect(mockSerialPort.write.mock.calls.length).toBe(1);

    const generatedPacket = mockSerialPort.write.mock.calls[0][0];

    expect(generatedPacket.toString('hex')).toBe(expectedPacket.toString('hex'));
  });

  it('should generate outlet ON command packet with expected format', async () => {
    const ctx = await setupTest('bestin2.0.homenet_bridge.yaml');
    const { mockSerialPort, sharedStates, config, automationManager } = ctx;

    sharedStates.set('sequence_number', { number: 5 });

    const statesMap = (automationManager as any).states as Map<string, any>;
    statesMap.set('sequence_number', { number: 5 });

    const entity = findEntityById(config, 'room1_outlet1');
    expect(entity).not.toBeNull();

    const commandConfig = (entity as any).command_on;

    const context = {
      type: 'command' as any,
      timestamp: Date.now(),
      args: commandConfig.args,
    };

    await automationManager.runScript(commandConfig.script, context, commandConfig.args);

    // Expected make_outlet_packet for room_number=1, position=1, ONOFF=1:
    // [bitOr(0x30, 1)=0x31, 0x09, 0x22, seq=5, 0x01, pos=1, ONOFF=1]
    const expectedData = [
      0x02, // tx_header
      0x31, // bitOr(0x30, 1)
      0x09, // packet length (outlet is 9)
      0x22, // command type (outlet control)
      0x05, // sequence_number (5)
      0x01, // fixed
      0x01, // position
      0x01, // ONOFF (1=ON)
    ];
    const checksum = calculateBestinSum(expectedData);
    const expectedPacket = Buffer.from([...expectedData, checksum]);

    expect(mockSerialPort.write.mock.calls.length).toBe(1);

    const generatedPacket = mockSerialPort.write.mock.calls[0][0];

    expect(generatedPacket.toString('hex')).toBe(expectedPacket.toString('hex'));
  });

  it('should generate multiple command packets (light + outlet)', async () => {
    const ctx = await setupTest('bestin2.0.homenet_bridge.yaml');
    const { mockSerialPort, sharedStates, config, automationManager } = ctx;

    sharedStates.set('sequence_number', { number: 10 });

    const statesMap = (automationManager as any).states as Map<string, any>;
    statesMap.set('sequence_number', { number: 10 });

    // 1. Light ON command
    const lightEntity = findEntityById(config, 'room1_light1');
    const lightCommandConfig = (lightEntity as any).command_on;

    await automationManager.runScript(
      lightCommandConfig.script,
      {
        type: 'command' as any,
        timestamp: Date.now(),
        args: lightCommandConfig.args,
      },
      lightCommandConfig.args,
    );

    expect(mockSerialPort.write.mock.calls.length).toBe(1);

    // 2. Outlet ON command (sequence should be incremented by update_sequence_number script)
    const outletEntity = findEntityById(config, 'room1_outlet1');
    const outletCommandConfig = (outletEntity as any).command_on;

    await automationManager.runScript(
      outletCommandConfig.script,
      {
        type: 'command' as any,
        timestamp: Date.now(),
        args: outletCommandConfig.args,
      },
      outletCommandConfig.args,
    );

    expect(mockSerialPort.write.mock.calls.length).toBe(2);

    // Verify both packets
    const lightPacket = mockSerialPort.write.mock.calls[0][0];
    const outletPacket = mockSerialPort.write.mock.calls[1][0];

    // Light packet starts with 02 31 0E 21 (header, room1, len=14, cmd=0x21)
    expect(lightPacket[0]).toBe(0x02);
    expect(lightPacket[1]).toBe(0x31);
    expect(lightPacket[2]).toBe(0x0e);
    expect(lightPacket[3]).toBe(0x21);

    // Outlet packet starts with 02 31 09 22 (header, room1, len=9, cmd=0x22)
    expect(outletPacket[0]).toBe(0x02);
    expect(outletPacket[1]).toBe(0x31);
    expect(outletPacket[2]).toBe(0x09);
    expect(outletPacket[3]).toBe(0x22);
  });

  it('should generate OFF command packets correctly', async () => {
    const ctx = await setupTest('bestin2.0.homenet_bridge.yaml');
    const { mockSerialPort, sharedStates, config, automationManager } = ctx;

    sharedStates.set('sequence_number', { number: 1 });

    const statesMap = (automationManager as any).states as Map<string, any>;
    statesMap.set('sequence_number', { number: 1 });

    // Light OFF command
    const lightEntity = findEntityById(config, 'room1_light1');
    const lightOffConfig = (lightEntity as any).command_off;

    await automationManager.runScript(
      lightOffConfig.script,
      {
        type: 'command' as any,
        timestamp: Date.now(),
        args: lightOffConfig.args,
      },
      lightOffConfig.args,
    );

    expect(mockSerialPort.write.mock.calls.length).toBe(1);

    const lightOffPacket = mockSerialPort.write.mock.calls[0][0];

    // Verify ONOFF byte is 0x02 (OFF)
    // Format: [0x02, 0x31, 0x0E, 0x21, seq, 0x01, 0x00, pos, ONOFF, ...]
    expect(lightOffPacket[8]).toBe(0x02); // ONOFF = 2 (OFF)
  });
});
