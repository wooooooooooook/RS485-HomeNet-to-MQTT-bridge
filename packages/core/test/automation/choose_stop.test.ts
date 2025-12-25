import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AutomationManager } from '../../src/automation/automation-manager.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';
import { PacketProcessor } from '../../src/protocol/packet-processor.js';
import { CommandManager } from '../../src/service/command.manager.js';
import { MqttPublisher } from '../../src/transports/mqtt/publisher.js';
import { eventBus } from '../../src/service/event-bus.js';

describe('choose and stop actions', () => {
    let automationManager: AutomationManager;
    let mockPacketProcessor: PacketProcessor;
    let mockCommandManager: CommandManager;
    let mockMqttPublisher: MqttPublisher;
    let sentPackets: number[][];

    const createConfig = (automation: any[]): HomenetBridgeConfig =>
        ({
            serial: {
                portId: 'test',
                path: '/dev/test',
                baud_rate: 9600,
                data_bits: 8,
                parity: 'none',
                stop_bits: 1,
            },
            serials: [],
            automation,
        }) as HomenetBridgeConfig;

    beforeEach(() => {
        vi.useFakeTimers();
        sentPackets = [];

        mockPacketProcessor = {
            on: vi.fn(),
            removeListener: vi.fn(),
        } as any;

        mockCommandManager = {
            send: vi.fn().mockResolvedValue(undefined),
        } as any;

        mockMqttPublisher = {
            publish: vi.fn(),
        } as any;
    });

    afterEach(() => {
        vi.useRealTimers();
        eventBus.removeAllListeners();
    });

    describe('choose action', () => {
        it('should execute first matching choice', async () => {
            const config = createConfig([
                {
                    id: 'test_choose',
                    trigger: [{ type: 'startup' }],
                    then: [
                        {
                            action: 'choose',
                            choices: [
                                {
                                    condition: "states['sensor']['value'] == 10",
                                    then: [{ action: 'log', message: 'first choice' }],
                                },
                                {
                                    condition: "states['sensor']['value'] == 20",
                                    then: [{ action: 'log', message: 'second choice' }],
                                },
                            ],
                            default: [{ action: 'log', message: 'default choice' }],
                        },
                    ],
                },
            ]);

            automationManager = new AutomationManager(
                config,
                mockPacketProcessor,
                mockCommandManager,
                mockMqttPublisher,
            );

            // Set state to match second choice
            eventBus.emit('state:changed', { entityId: 'sensor', state: { value: 20 } });

            automationManager.start();
            await vi.advanceTimersByTimeAsync(10);

            automationManager.stop();
        });

        it('should execute default when no choice matches', async () => {
            const config = createConfig([
                {
                    id: 'test_choose_default',
                    trigger: [{ type: 'startup' }],
                    then: [
                        {
                            action: 'choose',
                            choices: [
                                {
                                    condition: "states['sensor']['value'] == 100",
                                    then: [{ action: 'log', message: 'matched' }],
                                },
                            ],
                            default: [{ action: 'log', message: 'no match - default' }],
                        },
                    ],
                },
            ]);

            automationManager = new AutomationManager(
                config,
                mockPacketProcessor,
                mockCommandManager,
                mockMqttPublisher,
            );

            // Set state that doesn't match any choice
            eventBus.emit('state:changed', { entityId: 'sensor', state: { value: 50 } });

            automationManager.start();
            await vi.advanceTimersByTimeAsync(10);

            automationManager.stop();
        });

        it('should do nothing when no choice matches and no default', async () => {
            const config = createConfig([
                {
                    id: 'test_choose_no_default',
                    trigger: [{ type: 'startup' }],
                    then: [
                        {
                            action: 'choose',
                            choices: [
                                {
                                    condition: "states['sensor']['value'] == 100",
                                    then: [{ action: 'log', message: 'matched' }],
                                },
                            ],
                            // No default
                        },
                        { action: 'log', message: 'after choose' },
                    ],
                },
            ]);

            automationManager = new AutomationManager(
                config,
                mockPacketProcessor,
                mockCommandManager,
                mockMqttPublisher,
            );

            // Set state that doesn't match any choice
            eventBus.emit('state:changed', { entityId: 'sensor', state: { value: 50 } });

            automationManager.start();
            await vi.advanceTimersByTimeAsync(10);

            automationManager.stop();
        });

        it('should only execute first matching choice when multiple could match', async () => {
            const config = createConfig([
                {
                    id: 'test_choose_first_only',
                    trigger: [{ type: 'startup' }],
                    then: [
                        {
                            action: 'choose',
                            choices: [
                                {
                                    condition: "states['sensor']['value'] > 5",
                                    then: [{ action: 'log', message: 'first (>5)' }],
                                },
                                {
                                    condition: "states['sensor']['value'] > 10",
                                    then: [{ action: 'log', message: 'second (>10)' }],
                                },
                            ],
                        },
                    ],
                },
            ]);

            automationManager = new AutomationManager(
                config,
                mockPacketProcessor,
                mockCommandManager,
                mockMqttPublisher,
            );

            // Both conditions would match, but only first should execute
            eventBus.emit('state:changed', { entityId: 'sensor', state: { value: 20 } });

            automationManager.start();
            await vi.advanceTimersByTimeAsync(10);

            automationManager.stop();
        });
    });

    describe('stop action', () => {
        it('should stop automation and skip remaining actions', async () => {
            let logCount = 0;
            const originalLog = console.log;

            const config = createConfig([
                {
                    id: 'test_stop',
                    trigger: [{ type: 'startup' }],
                    then: [
                        { action: 'log', message: 'before stop' },
                        { action: 'stop', reason: 'test stop' },
                        { action: 'log', message: 'after stop - should not run' },
                    ],
                },
            ]);

            automationManager = new AutomationManager(
                config,
                mockPacketProcessor,
                mockCommandManager,
                mockMqttPublisher,
            );

            automationManager.start();
            await vi.advanceTimersByTimeAsync(10);

            automationManager.stop();
        });

        it('should stop automation inside if block', async () => {
            const config = createConfig([
                {
                    id: 'test_stop_in_if',
                    trigger: [{ type: 'startup' }],
                    then: [
                        {
                            action: 'if',
                            condition: "states['safety']['enabled'] == true",
                            then: [
                                { action: 'log', message: 'safety enabled, stopping' },
                                { action: 'stop', reason: 'safety mode' },
                            ],
                        },
                        { action: 'log', message: 'continuing - should not run if safety enabled' },
                    ],
                },
            ]);

            automationManager = new AutomationManager(
                config,
                mockPacketProcessor,
                mockCommandManager,
                mockMqttPublisher,
            );

            // Enable safety mode
            eventBus.emit('state:changed', { entityId: 'safety', state: { enabled: true } });

            automationManager.start();
            await vi.advanceTimersByTimeAsync(10);

            automationManager.stop();
        });

        it('should continue if stop is not reached due to condition', async () => {
            const config = createConfig([
                {
                    id: 'test_stop_not_reached',
                    trigger: [{ type: 'startup' }],
                    then: [
                        {
                            action: 'if',
                            condition: "states['safety']['enabled'] == true",
                            then: [{ action: 'stop', reason: 'safety mode' }],
                        },
                        { action: 'log', message: 'continuing - should run since safety disabled' },
                    ],
                },
            ]);

            automationManager = new AutomationManager(
                config,
                mockPacketProcessor,
                mockCommandManager,
                mockMqttPublisher,
            );

            // Disable safety mode
            eventBus.emit('state:changed', { entityId: 'safety', state: { enabled: false } });

            automationManager.start();
            await vi.advanceTimersByTimeAsync(10);

            automationManager.stop();
        });

        it('should stop automation inside choose block', async () => {
            const config = createConfig([
                {
                    id: 'test_stop_in_choose',
                    trigger: [{ type: 'startup' }],
                    then: [
                        {
                            action: 'choose',
                            choices: [
                                {
                                    condition: "states['mode']['state'] == 'emergency'",
                                    then: [
                                        { action: 'log', message: 'emergency mode detected' },
                                        { action: 'stop', reason: 'emergency stop' },
                                    ],
                                },
                            ],
                            default: [{ action: 'log', message: 'normal operation' }],
                        },
                        { action: 'log', message: 'after choose - should not run in emergency' },
                    ],
                },
            ]);

            automationManager = new AutomationManager(
                config,
                mockPacketProcessor,
                mockCommandManager,
                mockMqttPublisher,
            );

            // Set emergency mode
            eventBus.emit('state:changed', { entityId: 'mode', state: { state: 'emergency' } });

            automationManager.start();
            await vi.advanceTimersByTimeAsync(10);

            automationManager.stop();
        });
    });
});
