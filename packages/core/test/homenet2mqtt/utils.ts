import { vi, Mock } from 'vitest';
import { Buffer } from 'buffer';
import * as path from 'path';
import { access } from 'fs/promises';
import { loadConfig } from '../../src/config';
import { PacketProcessor } from '../../src/protocol/packet-processor';
import { StateManager } from '../../src/state/state-manager';
import { MqttPublisher } from '../../src/transports/mqtt/publisher';
import { clearStateCache } from '../../src/state/store';
import { CommandManager } from '../../src/service/command.manager';
import { HomenetBridgeConfig } from '../../src/config/types';
import { findEntityById } from '../../src/utils/entities';
import { AutomationManager } from '../../src/automation/automation-manager';

// Mock Bridge for PacketProcessor (EntityStateProvider)
export const bridgeMock = {
  getLightState: vi.fn(),
  getClimateState: vi.fn(),
  getAllStates: vi.fn().mockReturnValue({}),
  getEntityState: vi.fn(),
};

export interface TestContext {
  packetProcessor: PacketProcessor;
  stateManager: StateManager;
  commandManager: CommandManager;
  automationManager: AutomationManager;
  portId: string;
  config: HomenetBridgeConfig;
  mockSerialPort: any;
  publishMock: Mock;
  sharedStates: Map<string, Record<string, any>>;
}

const DEFAULT_TOPIC_PREFIX = 'homenet2mqtt/homedevice1';

export async function setupTest(configPath: string): Promise<TestContext> {
  vi.clearAllMocks();
  let absolutePath = path.resolve(__dirname, '../../config', configPath);

  try {
    await access(absolutePath);
  } catch {
    const examplePath = path.resolve(__dirname, '../../config/examples', configPath);
    await access(examplePath);
    absolutePath = examplePath;
  }

  const config = await loadConfig(absolutePath);
  // Override defaults for faster testing
  if (!config.packet_defaults) config.packet_defaults = {};
  config.packet_defaults.tx_retry_cnt = 0;
  config.packet_defaults.tx_timeout = 10;
  config.packet_defaults.tx_delay = 5;
  // IMPORTANT: Do NOT blindly overwrite header/footer here, or preserve them if needed.
  // The loadConfig should have already populated them.
  // We only touch retry/timeout/delay settings.

  const portId = config.serial.portId || 'default';
  clearStateCache();

  // Create fresh Mock SerialPort for each test to ensure isolation
  const mockSerialPort = {
    write: vi.fn((data, cb) => cb && cb()),
    on: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    removeListener: vi.fn(),
    destroy: vi.fn(),
  } as any;

  // Create fresh Mock Publisher for each test
  const publishMock = vi.fn();
  const mqttPublisherMock = {
    publish: publishMock,
  } as unknown as MqttPublisher;

  // Shared state map for CEL expression evaluation in PacketProcessor
  const sharedStates = new Map<string, Record<string, any>>();

  const packetProcessor = new PacketProcessor(config, bridgeMock, sharedStates);
  const stateManager = new StateManager(
    portId,
    config,
    packetProcessor,
    mqttPublisherMock,
    DEFAULT_TOPIC_PREFIX,
    sharedStates,
  );

  const commandManager = new CommandManager(mockSerialPort, config, portId, packetProcessor);

  // Create a commandSender function for AutomationManager's send_packet action
  const commandSender = async (_portId: string | undefined, packet: number[], _options?: any) => {
    // Directly write to the mock serial port
    const buffer = Buffer.from(packet);
    mockSerialPort.write(buffer, () => {});
  };

  // Create AutomationManager for script-based command support
  const automationManager = new AutomationManager(
    config,
    packetProcessor,
    commandManager,
    mqttPublisherMock,
    portId,
    commandSender,
    stateManager,
  );

  return {
    packetProcessor,
    stateManager,
    commandManager,
    automationManager,
    portId,
    config,
    mockSerialPort,
    publishMock,
    sharedStates,
  };
}

export function processPacket(stateManager: StateManager, packet: Buffer | number[]) {
  const data = Buffer.isBuffer(packet) ? packet : Buffer.from(packet);
  stateManager.processIncomingData(data);
}

export async function executeCommand(
  ctx: TestContext,
  entityId: string,
  commandName: string,
  value: any,
) {
  const entity = findEntityById(ctx.config, entityId);
  if (!entity) throw new Error(`Entity ${entityId} not found`);

  // Check if command is script-based
  const normalizedCommandName = commandName.startsWith('command_')
    ? commandName
    : `command_${commandName}`;
  const commandConfig = (entity as any)[normalizedCommandName];

  if (commandConfig && typeof commandConfig === 'object' && commandConfig.script) {
    // Use AutomationManager for script-based commands
    // Simulate a command action
    const context = {
      type: 'command' as any,
      timestamp: Date.now(),
      args: {},
    };
    await ctx.automationManager.runScript(commandConfig.script, context, {
      ...commandConfig.args,
      ...(value !== null && value !== undefined ? { x: value } : {}),
    });
    return;
  }

  const result = ctx.packetProcessor.constructCommandPacket(entity, commandName, value);
  if (!result) throw new Error(`Could not construct packet for ${entityId} ${commandName}`);

  // Handle both number[] and CommandResult
  const packet = Array.isArray(result) ? result : result.packet;
  const ackMatch = Array.isArray(result) ? undefined : result.ack;

  await ctx.commandManager.send(entity, packet, { ackMatch });
}
