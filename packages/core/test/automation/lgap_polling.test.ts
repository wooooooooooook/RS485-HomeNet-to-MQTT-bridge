import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { AutomationManager } from '../../src/automation/automation-manager.js';
import { CommandManager } from '../../src/service/command.manager.js';
import { PacketProcessor } from '../../src/protocol/packet-processor.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';
import { StateManager } from '../../src/state/state-manager.js';

const serial = {
  portId: 'lgap',
  path: '/dev/ttyUSB0',
  baud_rate: 4800,
  data_bits: 8,
  parity: 'none',
  stop_bits: 1,
} as const;

describe('LGAP polling automation', () => {
  let manager: AutomationManager;
  let packetProcessor: PacketProcessor & EventEmitter;
  let commandManager: CommandManager;
  let sendRaw: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    packetProcessor = new EventEmitter() as PacketProcessor & EventEmitter;
    commandManager = { send: vi.fn().mockResolvedValue(undefined) } as unknown as CommandManager;
    sendRaw = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    manager?.stop();
    vi.useRealTimers();
  });

  it('polls zone 0 immediately at startup with the automation context port', async () => {
    const config: HomenetBridgeConfig = {
      serial,
      packet_defaults: {
        tx_header: [0x80],
        tx_checksum: 'add_final_xor(0x55)',
      },
      automation: [
        {
          id: 'lgap_poll_zone_0',
          trigger: [{ type: 'startup' }],
          then: [
            {
              action: 'send_packet',
              data: [0x00, 0xa0, 0x00, 0x00, 0x00, 0x00],
              header: true,
              checksum: true,
            },
          ],
        },
      ],
    };

    manager = new AutomationManager({
      config,
      packetProcessor,
      commandManager,
      commandSender: sendRaw,
      stateManager: {} as StateManager,
      contextPortId: 'lgap',
    });
    manager.start();

    await vi.runAllTimersAsync();

    expect(sendRaw).toHaveBeenCalledTimes(1);
    expect(sendRaw).toHaveBeenCalledWith(
      'lgap',
      [0x80, 0x00, 0xa0, 0x00, 0x00, 0x00, 0x00, 0x75],
      expect.any(Object),
    );
  });

  it('polls zone 0 every 5 seconds using the automation context port', async () => {
    const config: HomenetBridgeConfig = {
      serial,
      packet_defaults: {
        tx_header: [0x80],
        tx_checksum: 'add_final_xor(0x55)',
      },
      automation: [
        {
          id: 'lgap_poll_zone_0',
          trigger: [{ type: 'schedule', every: '5s' }],
          then: [
            {
              action: 'send_packet',
              data: [0x00, 0xa0, 0x00, 0x00, 0x00, 0x00],
              header: true,
              checksum: true,
            },
          ],
        },
      ],
    };

    manager = new AutomationManager({
      config,
      packetProcessor,
      commandManager,
      commandSender: sendRaw,
      stateManager: {} as StateManager,
      contextPortId: 'lgap',
    });
    manager.start();

    expect(sendRaw).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4999);
    expect(sendRaw).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sendRaw).toHaveBeenCalledTimes(1);
    expect(sendRaw).toHaveBeenLastCalledWith(
      'lgap',
      [0x80, 0x00, 0xa0, 0x00, 0x00, 0x00, 0x00, 0x75],
      expect.any(Object),
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(sendRaw).toHaveBeenCalledTimes(2);
    expect(sendRaw).toHaveBeenLastCalledWith(
      'lgap',
      [0x80, 0x00, 0xa0, 0x00, 0x00, 0x00, 0x00, 0x75],
      expect.any(Object),
    );
  });
});
