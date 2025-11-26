import { vi } from 'vitest';
import { Buffer } from 'buffer';
import * as path from 'path';
import { loadConfig } from '../../src/config';
import { PacketProcessor } from '../../src/protocol/packet-processor';
import { StateManager } from '../../src/state/state-manager';
import { MqttPublisher } from '../../src/transports/mqtt/publisher';

// Mock MqttPublisher
export const publishMock = vi.fn();
export const mqttPublisherMock = {
    publish: publishMock,
} as unknown as MqttPublisher;

// Mock Bridge for PacketProcessor (EntityStateProvider)
export const bridgeMock = {
    getLightState: vi.fn(),
    getClimateState: vi.fn(),
};

export interface TestContext {
    packetProcessor: PacketProcessor;
    stateManager: StateManager;
}

export async function setupTest(configPath: string): Promise<TestContext> {
    vi.clearAllMocks();
    const absolutePath = path.resolve(__dirname, '../../config', configPath);
    const config = await loadConfig(absolutePath);

    const packetProcessor = new PacketProcessor(config, bridgeMock);
    const stateManager = new StateManager(config, packetProcessor, mqttPublisherMock);

    return { packetProcessor, stateManager };
}

export function processPacket(stateManager: StateManager, packet: Buffer | number[]) {
    const data = Buffer.isBuffer(packet) ? packet : Buffer.from(packet);
    stateManager.processIncomingData(data);
}
