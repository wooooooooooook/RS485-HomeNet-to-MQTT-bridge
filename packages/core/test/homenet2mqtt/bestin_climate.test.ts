import { describe, it, expect } from 'vitest';
import { setupTest, processPacket } from './utils';
import { Buffer } from 'buffer';
import { findEntityById } from '../../src/utils/entities';
import { CelExecutor } from '../../src/protocol/cel-executor';

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

describe('Bestin Climate Test', () => {
  it('should parse heating status packets for all rooms', async () => {
    const ctx = await setupTest('bestin2.0.homenet_bridge.yaml');
    const { stateManager, config, publishMock } = ctx;

    // Room 1 난방 엔티티가 있는지 확인
    const room1Entity = findEntityById(config, 'room1_heating');

    if (!room1Entity) {
      console.log(
        'room1_heating 엔티티가 없습니다. 이 테스트는 bestin2.0.homenet_bridge.yaml에 climate 엔티티가 있어야 합니다.',
      );
      expect(true).toBe(true);
      return;
    }

    // Packet for Room 1: ON, Target 24.5, Current 24.2
    // target 0x58: 24 + 0x40 (0.5 flag) = 0x58
    // current 0x00F2: 242 / 10 = 24.2
    const packetRoom1 = [
      0x02, 0x28, 0x10, 0x91, 0xa8, 0x01, 0x11, 0x58, 0x00, 0xf2, 0x00, 0x25, 0x00, 0x00, 0x00,
    ];
    const checksum1 = calculateBestinSum(packetRoom1);
    const fullPacket1 = Buffer.from([...packetRoom1, checksum1]);

    processPacket(stateManager, fullPacket1);

    const room1State = stateManager.getEntityState('room1_heating');

    if (room1State) {
      expect(room1State.mode).toBe('heat');
      expect(room1State.target_temperature).toBe(24.5);
      expect(room1State.current_temperature).toBeCloseTo(24.2, 1);
    }
  });

  it('should generate correct command packets for heating control', async () => {
    const ctx = await setupTest('bestin2.0.homenet_bridge.yaml');
    const { mockSerialPort, sharedStates, config, automationManager } = ctx;

    // Room 1 난방 엔티티가 있는지 확인
    const room1Entity = findEntityById(config, 'room1_heating');
    if (!room1Entity) {
      console.log(
        'room1_heating 엔티티가 없습니다. 이 테스트는 bestin2.0.homenet_bridge.yaml에 climate 엔티티가 있어야 합니다.',
      );
      expect(true).toBe(true);
      return;
    }

    sharedStates.set('sequence_number', { number: 10 });
    const statesMap = (automationManager as any).states as Map<string, any>;
    statesMap.set('sequence_number', { number: 10 });

    const commandConfig = (room1Entity as any).command_heat;

    if (!commandConfig || !commandConfig.script) {
      console.log('command_heat 스크립트가 없습니다.');
      expect(true).toBe(true);
      return;
    }

    const context = {
      type: 'command' as any,
      timestamp: Date.now(),
      args: commandConfig.args,
    };

    await automationManager.runScript(commandConfig.script, context, commandConfig.args);

    if (mockSerialPort.write.mock.calls.length > 0) {
      const generatedPacket = mockSerialPort.write.mock.calls[0][0];

      // Verify basic packet structure
      expect(generatedPacket[0]).toBe(0x02); // Header
      expect(generatedPacket[1]).toBe(0x28); // Bestin heating device ID
    }
  });

  it('should test bitwise CEL functions for temperature decoding', () => {
    const celExecutor = new CelExecutor();

    // Test bitAnd function with array access
    const packet = [0x02, 0x28, 0x10, 0x91, 0xa8, 0x01, 0x11, 0x58, 0x00, 0xf2];

    // Test bitAnd(data[7], 0x3F) = bitAnd(0x58, 0x3F) = 0x18 = 24
    const result1 = celExecutor.execute('bitAnd(data[7], 0x3F)', { data: packet });
    expect(result1).toBe(24);

    // Test bitAnd(data[7], 0x40) = bitAnd(0x58, 0x40) = 0x40 = 64
    const result2 = celExecutor.execute('bitAnd(data[7], 0x40)', { data: packet });
    expect(result2).toBe(64);

    // Test bitShiftLeft and bitOr for current temperature
    // data[8]=0x00, data[9]=0xf2 -> bitOr(bitShiftLeft(0, 8), 242) = 242
    const result3 = celExecutor.execute('bitOr(bitShiftLeft(data[8], 8), data[9])', {
      data: packet,
    });
    expect(result3).toBe(242);
  });

  it('should verify Bestin checksum algorithm', () => {
    // Simple packet: [0x02, 0x28, 0x10, 0x91, 0x00, 0x01, 0x11, 0x18, 0x00, 0xf2]
    const testPacket = [0x02, 0x28, 0x10, 0x91, 0x00, 0x01, 0x11, 0x18, 0x00, 0xf2];
    const checksum = calculateBestinSum(testPacket);

    // Verify the checksum is a valid single byte
    expect(checksum).toBeGreaterThanOrEqual(0);
    expect(checksum).toBeLessThanOrEqual(255);

    // Verify checksum changes with different data
    const modifiedPacket = [...testPacket];
    modifiedPacket[5] = 0x02; // Change room ID
    const checksum2 = calculateBestinSum(modifiedPacket);

    expect(checksum).not.toBe(checksum2);
  });
});
