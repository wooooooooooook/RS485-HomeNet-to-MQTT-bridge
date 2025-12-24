import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutomationManager } from '../../src/automation/automation-manager.js';
import { eventBus } from '../../src/service/event-bus.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';

describe('Samsung SDS Elevator Automation', () => {
  let automationManager: AutomationManager | undefined;
  let packetProcessor: EventEmitter & { constructCommandPacket: any };
  let commandManager: { send: any };
  let mqttPublisher: { publish: any };
  const mockSender = vi.fn().mockResolvedValue(undefined);

  describe('Old Style Protocol (4-byte packets)', () => {
    const config: HomenetBridgeConfig = {
      serial: {
        portId: 'samsung_sds',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'even',
        stop_bits: 1,
      } as any,
      serials: [{ portId: 'samsung_sds' }] as any,
      packet_defaults: {
        tx_checksum: 'samsung_tx',
        rx_checksum: 'samsung_rx',
      },
      switch: [
        {
          id: 'elevator_call',
          name: 'Elevator Call',
          type: 'switch',
          optimistic: true,
          state: { data: [] },
        },
      ],
      automation: [
        {
          id: 'status_response_comm',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xad, 0x5a, 0x00, 0x77] },
            },
          ],
          then: [
            {
              action: 'send_packet',
              data: [0xb0, 0x5a, 0x00, 0x6a],
              checksum: false,
            },
          ],
        },
        {
          id: 'status_response_elevator',
          mode: 'restart',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xad, 0x41, 0x00, 0x6c] },
            },
          ],
          then: [
            {
              action: 'send_packet',
              data: "states['elevator_call']['state'] == 'on' ? [0xB0, 0x2F, 0x01, 0x1E] : [0xB0, 0x41, 0x00, 0x71]",
              checksum: false,
            },
            {
              action: 'delay',
              milliseconds: '20s',
            },
            {
              action: 'command',
              target: 'id(elevator_call).command_off()',
            },
          ],
        },
        {
          id: 'elevator_call_ack',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xad, 0x2f, 0x00, 0x02] },
            },
          ],
          then: [
            {
              action: 'send_packet',
              data: [0xb0, 0x41, 0x00, 0x71],
              checksum: false,
            },
            {
              action: 'command',
              target: 'id(elevator_call).command_off()',
            },
          ],
        },
      ],
    };

    beforeEach(() => {
      vi.useFakeTimers();
      packetProcessor = Object.assign(new EventEmitter(), {
        constructCommandPacket: vi.fn(),
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

    it('장치 스캔 패킷(AD 5A 00 77) 수신 시 응답 패킷(B0 5A 00 6A)을 전송해야 한다', async () => {
      packetProcessor.emit('packet', [0xad, 0x5a, 0x00, 0x77]);
      await vi.runAllTimersAsync();
      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [0xb0, 0x5a, 0x00, 0x6a],
        expect.anything(),
      );
    });

    it('호출 중이지 않을 때(AD 41 00 6C) 기본 패킷(B0 41 00 71)을 전송해야 한다', async () => {
      eventBus.emit('state:changed', { entityId: 'elevator_call', state: { state: 'off' } });
      packetProcessor.emit('packet', [0xad, 0x41, 0x00, 0x6c]);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [0xb0, 0x41, 0x00, 0x71],
        expect.anything(),
      );
    });

    it('호출 중일 때(AD 41 00 6C) 호출됨 패킷(B0 2F 01 1E)을 전송해야 한다', async () => {
      eventBus.emit('state:changed', { entityId: 'elevator_call', state: { state: 'on' } });
      packetProcessor.emit('packet', [0xad, 0x41, 0x00, 0x6c]);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [0xb0, 0x2f, 0x01, 0x1e],
        expect.anything(),
      );
    });
  });

  describe('New Style Protocol (5-byte packets)', () => {
    const config: HomenetBridgeConfig = {
      serial: {
        portId: 'samsung_sds',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'even',
        stop_bits: 1,
      } as any,
      serials: [{ portId: 'samsung_sds' }] as any,
      packet_defaults: {
        tx_checksum: 'samsung_tx',
        rx_checksum: 'samsung_rx',
      },
      switch: [
        {
          id: 'elevator_call',
          name: 'Elevator Call',
          type: 'switch',
          optimistic: true,
          state: { data: [] },
        },
      ],
      automation: [
        {
          id: 'status_response_comm',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xcc, 0x5a, 0x01, 0x00, 0x17] },
            },
          ],
          then: [
            {
              action: 'send_packet',
              data: [0xb0, 0x5a, 0x01, 0x00, 0x6b],
              checksum: false,
            },
          ],
        },
        {
          id: 'status_response_elevator',
          mode: 'restart',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xcc, 0x41, 0x01, 0x00, 0x0c] },
            },
          ],
          then: [
            {
              action: 'send_packet',
              data: "states['elevator_call']['state'] == 'on' ? [0xB0, 0x10, 0x01, 0x01, 0x20] : [0xB0, 0x41, 0x01, 0x00, 0x70]",
              checksum: false,
            },
            {
              action: 'delay',
              milliseconds: '20s',
            },
            {
              action: 'command',
              target: 'id(elevator_call).command_off()',
            },
          ],
        },
        {
          id: 'elevator_call_ack',
          trigger: [
            {
              type: 'packet',
              match: { data: [0xcc, 0x10, 0x01, 0x01, 0x5c] },
            },
          ],
          then: [
            {
              action: 'send_packet',
              data: [0xb0, 0x41, 0x01, 0x00, 0x70],
              checksum: false,
            },
            {
              action: 'command',
              target: 'id(elevator_call).command_off()',
            },
          ],
        },
      ],
    };

    beforeEach(() => {
      vi.useFakeTimers();
      packetProcessor = Object.assign(new EventEmitter(), {
        constructCommandPacket: vi.fn(),
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

    it('장치 스캔 패킷(CC 5A 01 00 17) 수신 시 응답 패킷(B0 5A 01 00 6B)을 전송해야 한다', async () => {
      packetProcessor.emit('packet', [0xcc, 0x5a, 0x01, 0x00, 0x17]);
      await vi.runAllTimersAsync();
      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [0xb0, 0x5a, 0x01, 0x00, 0x6b],
        expect.anything(),
      );
    });

    it('호출 중이지 않을 때(CC 41 01 00 0C) 기본 패킷(B0 41 01 00 70)을 전송해야 한다', async () => {
      eventBus.emit('state:changed', { entityId: 'elevator_call', state: { state: 'off' } });
      packetProcessor.emit('packet', [0xcc, 0x41, 0x01, 0x00, 0x0c]);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [0xb0, 0x41, 0x01, 0x00, 0x70],
        expect.anything(),
      );
    });

    it('호출 중일 때(CC 41 01 00 0C) 호출됨 패킷(B0 10 01 01 20)을 전송해야 한다', async () => {
      eventBus.emit('state:changed', { entityId: 'elevator_call', state: { state: 'on' } });
      packetProcessor.emit('packet', [0xcc, 0x41, 0x01, 0x00, 0x0c]);
      await vi.advanceTimersByTimeAsync(1);
      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [0xb0, 0x10, 0x01, 0x01, 0x20],
        expect.anything(),
      );
    });

    it('호출 완료 패킷(CC 10 01 01 5C) 수신 시 응답 패킷 전송 및 스위치를 꺼야 한다', async () => {
      eventBus.emit('state:changed', { entityId: 'elevator_call', state: { state: 'on' } });
      packetProcessor.emit('packet', [0xcc, 0x10, 0x01, 0x01, 0x5c]);
      await vi.runAllTimersAsync();
      expect(mockSender).toHaveBeenCalledWith(
        undefined,
        [0xb0, 0x41, 0x01, 0x00, 0x70],
        expect.anything(),
      );
      expect(packetProcessor.constructCommandPacket).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'elevator_call' }),
        'command_off',
        undefined,
      );
    });
  });
});
