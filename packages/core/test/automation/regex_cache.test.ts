import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutomationManager } from '../../src/automation/automation-manager.js';
import { PacketProcessor } from '../../src/protocol/packet-processor.js';
import { CommandManager } from '../../src/service/command.manager.js';
import { MqttPublisher } from '../../src/transports/mqtt/publisher.js';
import { StateManager } from '../../src/state/state-manager.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';

describe('AutomationManager Regex Caching', () => {
  let automationManager: AutomationManager;
  let packetProcessor: PacketProcessor;
  let commandManager: CommandManager;
  let mqttPublisher: MqttPublisher;
  let stateManager: StateManager;

  const config: HomenetBridgeConfig = {
    serial: { portId: 'test', path: '/dev/null' },
    automation: [],
  };

  beforeEach(() => {
    // Mock dependencies
    packetProcessor = {
      on: vi.fn(),
      off: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as any;
    commandManager = {} as any;
    mqttPublisher = {} as any;
    stateManager = {
      getAllStates: vi.fn().mockReturnValue({}),
    } as any;

    automationManager = new AutomationManager({
      config: config,
      packetProcessor: packetProcessor,
      commandManager: commandManager,
      mqttPublisher: mqttPublisher,
      contextPortId: 'test-port',
      stateManager: stateManager,
    });
  });

  afterEach(() => {
    automationManager.stop();
  });

  it('should compile regex on first use and store in cache', () => {
    // Access private members for white-box testing
    const automationAny = automationManager as any;
    const regexCache = automationAny.regexCache as Map<string, RegExp>;
    // Bind private method to instance
    const matchesValue = automationAny.matchesValue.bind(automationManager);

    expect(regexCache.size).toBe(0);

    const pattern = '/^test-[0-9]+$/';
    const val1 = 'test-123';

    // First call: Should compile and store
    const result1 = matchesValue(val1, pattern);

    expect(result1).toBe(true);
    expect(regexCache.size).toBe(1);
    expect(regexCache.has(pattern)).toBe(true);

    const cachedRegex = regexCache.get(pattern);
    expect(cachedRegex).toBeInstanceOf(RegExp);
  });

  it('should reuse cached regex for subsequent calls', () => {
    const automationAny = automationManager as any;
    const regexCache = automationAny.regexCache as Map<string, RegExp>;
    const matchesValue = automationAny.matchesValue.bind(automationManager);

    const pattern = '/^reused$/';

    // First call
    matchesValue('reused', pattern);
    const firstRegex = regexCache.get(pattern);

    // Second call
    matchesValue('reused', pattern);
    const secondRegex = regexCache.get(pattern);

    // Should be strictly equal (same object reference)
    expect(firstRegex).toBe(secondRegex);
  });

  it('should handle multiple distinct patterns independently', () => {
    const automationAny = automationManager as any;
    const regexCache = automationAny.regexCache as Map<string, RegExp>;
    const matchesValue = automationAny.matchesValue.bind(automationManager);

    const pattern1 = '/^abc/';
    const pattern2 = '/xyz$/';

    matchesValue('abcde', pattern1);
    expect(regexCache.size).toBe(1);

    matchesValue('vwxyz', pattern2);
    expect(regexCache.size).toBe(2);

    expect(regexCache.has(pattern1)).toBe(true);
    expect(regexCache.has(pattern2)).toBe(true);
  });

  it('should clear cache when stop() is called', () => {
    const automationAny = automationManager as any;
    const regexCache = automationAny.regexCache as Map<string, RegExp>;
    const matchesValue = automationAny.matchesValue.bind(automationManager);

    matchesValue('abc', '/^abc/');
    expect(regexCache.size).toBe(1);

    automationManager.stop();
    expect(regexCache.size).toBe(0);
  });

  it('should correctly match regex patterns', () => {
    const automationAny = automationManager as any;
    const matchesValue = automationAny.matchesValue.bind(automationManager);

    expect(matchesValue('hello world', '/^hello/')).toBe(true);
    expect(matchesValue('goodbye world', '/^hello/')).toBe(false);
    expect(matchesValue('12345', '/^[0-9]+$/')).toBe(true);
    expect(matchesValue('123a45', '/^[0-9]+$/')).toBe(false);
  });
});
