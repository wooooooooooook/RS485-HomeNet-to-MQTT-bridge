import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutomationManager } from '../../src/automation/automation-manager.js';
import { eventBus } from '../../src/service/event-bus.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';

describe('Samsung SDS Doorbell Automation', () => {
  let automationManager: AutomationManager | undefined;
  let packetProcessor: EventEmitter & { constructCommandPacket: any };
  let commandManager: { send: any };
  let mqttPublisher: { publish: any };
  const mockSender = vi.fn().mockResolvedValue(undefined);

  // Checksum calculation for Samsung SDS TX (xor with 0x80)
  const calculateChecksum = (data: number[]): number => {
    let crc = 0;
    for (const byte of data) {
      crc ^= byte;
    }
    crc ^= 0x80;
    return crc;
  };

  const config: HomenetBridgeConfig = {
    serial: {
      portId: 'samsung_sds_door',
      baud_rate: 9600,
      data_bits: 8,
      parity: 'even',
      stop_bits: 1,
    } as any,
    serials: [{ portId: 'samsung_sds_door' }] as any,
    packet_defaults: {
      tx_checksum: 'samsung_tx',
      rx_checksum: 'samsung_rx',
    },
    // 자동열기 스위치
    switch: [
      {
        id: 'doorbell_auto_open_private',
        name: '개인현관벨 자동열기',
        type: 'switch',
        optimistic: true,
        state: { data: [] },
      },
      {
        id: 'doorbell_auto_open_public',
        name: '공용현관벨 자동열기',
        type: 'switch',
        optimistic: true,
        state: { data: [] },
      },
    ],
    // 현관벨 상태
    binary_sensor: [
      {
        id: 'doorbell_private',
        name: '개인현관벨',
        type: 'binary_sensor',
        state: { data: [0x30], mask: [0xf0] },
        state_on: { data: [0x31, 0x00] },
        state_off: { data: [0x3e, 0x01], mask: [0xff, 0x01] },
      },
      {
        id: 'doorbell_public',
        name: '공용현관벨',
        type: 'binary_sensor',
        state: { data: [0x30], mask: [0xf0] },
        state_on: { data: [0x32, 0x00] },
        state_off: { data: [0x3e, 0x06], mask: [0xff, 0x06] },
      },
    ],
    // 상태 관리용 text
    text: [
      {
        id: 'door_state',
        name: '현관문 상태',
        type: 'text',
        internal: true,
        optimistic: true,
        initial_value: 'D_IDLE',
      },
    ],
    automation: [
      // 0x5A 수신 시 초기화 응답
      {
        id: 'response_init',
        trigger: [
          {
            type: 'packet',
            match: { data: [0xa4, 0x5a], mask: [0xff, 0xff] },
          },
        ],
        then: [
          {
            action: 'send_packet',
            data: [0xb0, 0x5a, 0x00],
            checksum: true,
          },
        ],
      },
      // 0x41 수신 시 상태에 따라 응답
      {
        id: 'response_query',
        trigger: [
          {
            type: 'packet',
            match: { data: [0xa4, 0x41], mask: [0xff, 0xff] },
          },
        ],
        then: [
          {
            action: 'if',
            condition: "states['door_state']['state'] == 'D_IDLE'",
            then: [
              {
                action: 'send_packet',
                data: [0xb0, 0x41, 0x00],
                checksum: true,
              },
            ],
            else: [
              {
                action: 'if',
                condition: "states['door_state']['state'] == 'D_CALL'",
                then: [
                  {
                    action: 'send_packet',
                    data: [0xb0, 0x36, 0x01],
                    checksum: true,
                  },
                ],
                else: [
                  {
                    action: 'if',
                    condition: "states['door_state']['state'] == 'D_OPEN'",
                    then: [
                      {
                        action: 'send_packet',
                        data: [0xb0, 0x3b, 0x00],
                        checksum: true,
                      },
                    ],
                    else: [
                      {
                        action: 'send_packet',
                        data: [0xb0, 0x42, 0x00],
                        checksum: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      // 개인현관벨 울림 시 자동문열기 시퀀스
      {
        id: 'doorbell_private_ring',
        mode: 'restart',
        trigger: [
          {
            type: 'state',
            entity_id: 'doorbell_private',
            property: 'state',
            match: 'on',
          },
        ],
        then: [
          {
            action: 'command',
            target: "id(door_state).command_set('D_BELL')",
          },
          {
            action: 'if',
            condition: "states['doorbell_auto_open_private']['state'] == 'on'",
            then: [
              { action: 'delay', milliseconds: '2s' },
              { action: 'command', target: "id(door_state).command_set('D_CALL')" },
              { action: 'delay', milliseconds: '3s' },
              { action: 'command', target: "id(door_state).command_set('D_OPEN')" },
            ],
          },
        ],
      },
      // 개인현관벨 종료 시 상태 초기화
      {
        id: 'doorbell_private_end',
        trigger: [
          {
            type: 'state',
            entity_id: 'doorbell_private',
            property: 'state',
            match: 'off',
          },
        ],
        then: [
          {
            action: 'command',
            target: "id(door_state).command_set('D_IDLE')",
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    packetProcessor = Object.assign(new EventEmitter(), {
      constructCommandPacket: vi.fn().mockReturnValue([]),
    });
    commandManager = { send: vi.fn().mockResolvedValue(undefined) };
    mqttPublisher = { publish: vi.fn() };
    mockSender.mockClear();

    automationManager = new AutomationManager(
      config,
      packetProcessor as any,
      commandManager as any,
      mqttPublisher as any,
      undefined,
      mockSender,
    );
    automationManager.start();
  });

  afterEach(() => {
    automationManager?.stop();
    eventBus.removeAllListeners();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('패킷 응답 처리', () => {
    it('초기화 패킷(A4 5A) 수신 시 응답 패킷(B0 5A 00 + checksum)을 전송해야 한다', async () => {
      packetProcessor.emit('packet', [0xa4, 0x5a, 0x00, 0x00]);
      await vi.runAllTimersAsync();

      const expectedData = [0xb0, 0x5a, 0x00];
      const expectedChecksum = calculateChecksum(expectedData);

      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [...expectedData, expectedChecksum],
        expect.anything(),
      );
    });

    it('상태가 D_IDLE일 때 쿼리 패킷(A4 41) 수신 시 대기 패킷(B0 41 00)을 전송해야 한다', async () => {
      // Set door_state to D_IDLE
      eventBus.emit('state:changed', { entityId: 'door_state', state: { state: 'D_IDLE' } });
      await vi.advanceTimersByTimeAsync(10);

      packetProcessor.emit('packet', [0xa4, 0x41, 0x00, 0x00]);
      await vi.advanceTimersByTimeAsync(10);

      const expectedData = [0xb0, 0x41, 0x00];
      const expectedChecksum = calculateChecksum(expectedData);

      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [...expectedData, expectedChecksum],
        expect.anything(),
      );
    });

    it('상태가 D_CALL일 때 쿼리 패킷(A4 41) 수신 시 통화 패킷(B0 36 01)을 전송해야 한다', async () => {
      // Set door_state to D_CALL
      eventBus.emit('state:changed', { entityId: 'door_state', state: { state: 'D_CALL' } });
      await vi.advanceTimersByTimeAsync(10);

      packetProcessor.emit('packet', [0xa4, 0x41, 0x00, 0x00]);
      await vi.advanceTimersByTimeAsync(10);

      const expectedData = [0xb0, 0x36, 0x01];
      const expectedChecksum = calculateChecksum(expectedData);

      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [...expectedData, expectedChecksum],
        expect.anything(),
      );
    });

    it('상태가 D_OPEN일 때 쿼리 패킷(A4 41) 수신 시 문열기 패킷(B0 3B 00)을 전송해야 한다', async () => {
      // Set door_state to D_OPEN
      eventBus.emit('state:changed', { entityId: 'door_state', state: { state: 'D_OPEN' } });
      await vi.advanceTimersByTimeAsync(10);

      packetProcessor.emit('packet', [0xa4, 0x41, 0x00, 0x00]);
      await vi.advanceTimersByTimeAsync(10);

      const expectedData = [0xb0, 0x3b, 0x00];
      const expectedChecksum = calculateChecksum(expectedData);

      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [...expectedData, expectedChecksum],
        expect.anything(),
      );
    });
  });

  describe('벨 울림 시 자동문열기 시퀀스', () => {
    it('자동열기가 OFF일 때 벨이 울리면 상태만 D_BELL로 변경해야 한다', async () => {
      // Auto open is OFF
      eventBus.emit('state:changed', {
        entityId: 'doorbell_auto_open_private',
        state: { state: 'off' },
      });
      await vi.advanceTimersByTimeAsync(10);

      // Doorbell rings
      eventBus.emit('state:changed', { entityId: 'doorbell_private', state: { state: 'on' } });
      await vi.advanceTimersByTimeAsync(100);

      // Should call command_set('D_BELL')
      expect(packetProcessor.constructCommandPacket).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'door_state' }),
        'command_set',
        "'D_BELL'",
      );

      // Wait 5 seconds - should NOT progress to D_CALL
      await vi.advanceTimersByTimeAsync(5000);

      // Should not have called command_set('D_CALL')
      const calls = packetProcessor.constructCommandPacket.mock.calls;
      const callCommandCalls = calls.filter(
        (c: any[]) => c[1] === 'command_set' && c[2] === "'D_CALL'",
      );
      expect(callCommandCalls.length).toBe(0);
    });

    it('자동열기가 ON일 때 벨이 울리면 2초 후 D_CALL, 3초 후 D_OPEN으로 상태가 변경되어야 한다', async () => {
      // Auto open is ON
      eventBus.emit('state:changed', {
        entityId: 'doorbell_auto_open_private',
        state: { state: 'on' },
      });
      await vi.advanceTimersByTimeAsync(10);

      // Doorbell rings
      eventBus.emit('state:changed', { entityId: 'doorbell_private', state: { state: 'on' } });
      await vi.advanceTimersByTimeAsync(100);

      // Should immediately call command_set('D_BELL')
      expect(packetProcessor.constructCommandPacket).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'door_state' }),
        'command_set',
        "'D_BELL'",
      );

      // Wait 2 seconds
      await vi.advanceTimersByTimeAsync(2000);

      // Should call command_set('D_CALL')
      expect(packetProcessor.constructCommandPacket).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'door_state' }),
        'command_set',
        "'D_CALL'",
      );

      // Wait 3 more seconds
      await vi.advanceTimersByTimeAsync(3000);

      // Should call command_set('D_OPEN')
      expect(packetProcessor.constructCommandPacket).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'door_state' }),
        'command_set',
        "'D_OPEN'",
      );
    });

    it('벨이 꺼지면 상태가 D_IDLE로 초기화되어야 한다', async () => {
      // Doorbell turns off
      eventBus.emit('state:changed', { entityId: 'doorbell_private', state: { state: 'off' } });
      await vi.advanceTimersByTimeAsync(100);

      // Should call command_set('D_IDLE')
      expect(packetProcessor.constructCommandPacket).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'door_state' }),
        'command_set',
        "'D_IDLE'",
      );
    });
  });

  describe('restart 모드 동작', () => {
    it('벨이 연속으로 울리면 이전 시퀀스가 취소되고 새 시퀀스가 시작되어야 한다', async () => {
      // Auto open is ON
      eventBus.emit('state:changed', {
        entityId: 'doorbell_auto_open_private',
        state: { state: 'on' },
      });
      await vi.advanceTimersByTimeAsync(10);

      // First ring
      eventBus.emit('state:changed', { entityId: 'doorbell_private', state: { state: 'on' } });
      await vi.advanceTimersByTimeAsync(100);

      // Reset mock to track new calls
      packetProcessor.constructCommandPacket.mockClear();

      // Wait 1 second (before D_CALL)
      await vi.advanceTimersByTimeAsync(1000);

      // Second ring (should restart)
      eventBus.emit('state:changed', { entityId: 'doorbell_private', state: { state: 'on' } });
      await vi.advanceTimersByTimeAsync(100);

      // Should call D_BELL again
      expect(packetProcessor.constructCommandPacket).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'door_state' }),
        'command_set',
        "'D_BELL'",
      );

      // Wait 2 seconds from second ring
      await vi.advanceTimersByTimeAsync(2000);

      // Should call D_CALL
      expect(packetProcessor.constructCommandPacket).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'door_state' }),
        'command_set',
        "'D_CALL'",
      );
    });
  });
});
