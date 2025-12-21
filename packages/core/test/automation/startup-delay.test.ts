import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationManager } from '../../src/automation/automation-manager.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';
import { PacketProcessor } from '../../src/protocol/packet-processor.js';
import { CommandManager } from '../../src/service/command.manager.js';
import { MqttPublisher } from '../../src/transports/mqtt/publisher.js';
import { logger } from '../../src/utils/logger.js';

describe('AutomationManager Startup Delay', () => {
  let automationManager: AutomationManager;
  let mockPacketProcessor: PacketProcessor;
  let mockCommandManager: CommandManager;
  let mockMqttPublisher: MqttPublisher;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock logger to avoid console output during tests
    vi.spyOn(logger, 'info').mockImplementation(() => logger);
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    vi.spyOn(logger, 'error').mockImplementation(() => logger);

    mockPacketProcessor = {
      on: vi.fn(),
      removeListener: vi.fn(),
      constructCommandPacket: vi.fn(),
    } as any;

    mockCommandManager = {
      send: vi.fn(),
    } as any;

    mockMqttPublisher = {
      publish: vi.fn(),
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should execute startup automation immediately (0 delay) by default', () => {
    const config: HomenetBridgeConfig = {
      serial: { portId: 'test', path: '/dev/test', baud_rate: 9600 } as any,
      serials: [],
      automation: [
        {
          id: 'auto_immediate',
          trigger: [{ type: 'startup' }],
          then: [{ action: 'log', message: 'Immediate execution' }],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      mockPacketProcessor,
      mockCommandManager,
      mockMqttPublisher,
    );

    automationManager.start();

    // Fast-forward slightly to trigger 0ms timeout
    vi.advanceTimersByTime(1);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ automation: 'auto_immediate' }),
      expect.stringContaining('Executing'),
    );
  });

  it('should execute startup automation after specified delay', () => {
    const config: HomenetBridgeConfig = {
      serial: { portId: 'test', path: '/dev/test', baud_rate: 9600 } as any,
      serials: [],
      automation: [
        {
          id: 'auto_delayed',
          trigger: [{ type: 'startup', delay: 5000 }],
          then: [{ action: 'log', message: 'Delayed execution' }],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      mockPacketProcessor,
      mockCommandManager,
      mockMqttPublisher,
    );

    automationManager.start();

    // Should not have run yet
    vi.advanceTimersByTime(100);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ automation: 'auto_delayed' }),
      expect.any(String),
    );

    // Fast-forward past delay
    vi.advanceTimersByTime(5000);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ automation: 'auto_delayed' }),
      expect.stringContaining('Executing'),
    );
  });

  it('should parse string duration for delay', () => {
    const config: HomenetBridgeConfig = {
      serial: { portId: 'test', path: '/dev/test', baud_rate: 9600 } as any,
      serials: [],
      automation: [
        {
          id: 'auto_string_delay',
          trigger: [{ type: 'startup', delay: '2s' }],
          then: [{ action: 'log', message: 'String delay execution' }],
        },
      ],
    };

    automationManager = new AutomationManager(
      config,
      mockPacketProcessor,
      mockCommandManager,
      mockMqttPublisher,
    );

    automationManager.start();

    // Should not have run yet
    vi.advanceTimersByTime(100);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ automation: 'auto_string_delay' }),
      expect.any(String),
    );

    // Fast-forward past delay (2s = 2000ms)
    vi.advanceTimersByTime(2000);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ automation: 'auto_string_delay' }),
      expect.stringContaining('Executing'),
    );
  });
});
