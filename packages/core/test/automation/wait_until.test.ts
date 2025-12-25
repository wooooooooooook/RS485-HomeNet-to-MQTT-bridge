import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AutomationManager } from '../../src/automation/automation-manager.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';
import { PacketProcessor } from '../../src/protocol/packet-processor.js';
import { CommandManager } from '../../src/service/command.manager.js';
import { MqttPublisher } from '../../src/transports/mqtt/publisher.js';
import { eventBus } from '../../src/service/event-bus.js';

describe('wait_until action', () => {
    let automationManager: AutomationManager;
    let mockPacketProcessor: PacketProcessor;
    let mockCommandManager: CommandManager;
    let mockMqttPublisher: MqttPublisher;

    const createConfig = (automation: any[]): HomenetBridgeConfig => ({
        serial: {
            portId: 'test',
            path: '/dev/test',
            baud_rate: 9600,
            data_bits: 8,
            parity: 'none',
            stop_bits: 1,
        },
        serials: [],
        binary_sensor: [
            {
                id: 'test_sensor',
                name: 'Test Sensor',
                state: { data: [0x01] },
                state_on: { data: [0x01] },
                state_off: { data: [0x00] },
            },
        ],
        automation,
    });

    beforeEach(() => {
        vi.useFakeTimers();

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

    it('should wait until condition is met', async () => {
        const actionLog: string[] = [];

        const config = createConfig([
            {
                id: 'test_automation',
                trigger: [{ type: 'startup' }],
                then: [
                    { action: 'log', message: 'before wait_until' },
                    {
                        action: 'wait_until',
                        condition: "states['test_sensor']['state'] == 'off'",
                        timeout: '5s',
                        check_interval: 100,
                    },
                    { action: 'log', message: 'after wait_until' },
                ],
            },
        ]);

        automationManager = new AutomationManager(
            config,
            mockPacketProcessor,
            mockCommandManager,
            mockMqttPublisher,
        );

        // Set initial state to 'on'
        eventBus.emit('state:changed', { entityId: 'test_sensor', state: { state: 'on' } });

        automationManager.start();

        // Advance time to let startup trigger fire
        await vi.advanceTimersByTimeAsync(10);

        // Change state to 'off' after 200ms
        setTimeout(() => {
            eventBus.emit('state:changed', { entityId: 'test_sensor', state: { state: 'off' } });
        }, 200);

        // Advance time past the condition being met
        await vi.advanceTimersByTimeAsync(500);

        automationManager.stop();
    });

    it('should timeout if condition is never met', async () => {
        const config = createConfig([
            {
                id: 'test_automation',
                trigger: [{ type: 'startup' }],
                then: [
                    {
                        action: 'wait_until',
                        condition: "states['test_sensor']['state'] == 'impossible_value'",
                        timeout: '1s',
                        check_interval: 100,
                    },
                    { action: 'log', message: 'after timeout' },
                ],
            },
        ]);

        automationManager = new AutomationManager(
            config,
            mockPacketProcessor,
            mockCommandManager,
            mockMqttPublisher,
        );

        // Set initial state
        eventBus.emit('state:changed', { entityId: 'test_sensor', state: { state: 'on' } });

        automationManager.start();

        // Advance time for startup trigger
        await vi.advanceTimersByTimeAsync(10);

        // Advance time past timeout (1s + buffer)
        await vi.advanceTimersByTimeAsync(1500);

        automationManager.stop();
    });

    it('should use default timeout and check_interval when not specified', async () => {
        const config = createConfig([
            {
                id: 'test_automation',
                trigger: [{ type: 'startup' }],
                then: [
                    {
                        action: 'wait_until',
                        condition: "states['test_sensor']['state'] == 'off'",
                        // timeout and check_interval not specified - should use defaults
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

        // Set initial state
        eventBus.emit('state:changed', { entityId: 'test_sensor', state: { state: 'off' } });

        automationManager.start();

        // Advance time for startup trigger
        await vi.advanceTimersByTimeAsync(10);

        // Should complete immediately since condition is already met
        await vi.advanceTimersByTimeAsync(200);

        automationManager.stop();
    });

    it('should be abortable when automation is restarted', async () => {
        const config = createConfig([
            {
                id: 'test_automation',
                mode: 'restart',
                trigger: [{ type: 'state', entity_id: 'test_sensor', property: 'state', match: 'on' }],
                then: [
                    {
                        action: 'wait_until',
                        condition: "states['test_sensor']['state'] == 'off'",
                        timeout: '10s',
                    },
                    { action: 'log', message: 'completed' },
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

        // Trigger automation first time
        eventBus.emit('state:changed', { entityId: 'test_sensor', state: { state: 'on' } });

        // Advance time a bit (wait_until is running)
        await vi.advanceTimersByTimeAsync(500);

        // Trigger automation again (should restart/abort first one)
        eventBus.emit('state:changed', { entityId: 'test_sensor', state: { state: 'on' } });

        // Advance time
        await vi.advanceTimersByTimeAsync(500);

        // Satisfy the condition
        eventBus.emit('state:changed', { entityId: 'test_sensor', state: { state: 'off' } });

        await vi.advanceTimersByTimeAsync(200);

        automationManager.stop();
    });
});
