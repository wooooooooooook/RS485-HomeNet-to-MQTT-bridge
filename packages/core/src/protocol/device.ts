import { DeviceConfig, StateSchema, StateNumSchema, ProtocolConfig } from './types.js';

export abstract class Device {
    protected config: DeviceConfig;
    protected protocolConfig: ProtocolConfig;
    protected state: Record<string, any> = {};

    constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
        this.config = config;
        this.protocolConfig = protocolConfig;
    }

    public abstract parseData(packet: number[]): Record<string, any> | null;

    public abstract constructCommand(commandName: string, value?: any): number[] | null;

    public getId(): string {
        return this.config.id;
    }

    public getName(): string {
        return this.config.name;
    }

    public getState(): Record<string, any> {
        return this.state;
    }

    protected updateState(newState: Record<string, any>) {
        this.state = { ...this.state, ...newState };
    }

    // Helper to extract data based on schema
    protected extractFromSchema(packet: number[], schema: StateSchema | StateNumSchema): any {
        // TODO: Implement full extraction logic (mask, offset, inverted, etc.)
        // This is a simplified version
        if (schema.offset !== undefined && schema.data) {
            // Check if data matches
            // ...
        }
        return null;
    }

    public matchesPacket(packet: number[]): boolean {
        const stateConfig = this.config.state;
        if (!stateConfig || !stateConfig.data) {
            // If no state config, we can't match based on state pattern.
            // However, some devices might be command-only or use other matching.
            // But for the purpose of "state update", we usually need a match.
            // Let's return false to be safe, preventing random updates.
            return false;
        }

        const offset = stateConfig.offset || 0;
        if (packet.length < offset + stateConfig.data.length) {
            return false;
        }

        for (let i = 0; i < stateConfig.data.length; i++) {
            let mask = 0xFF;
            if (stateConfig.mask) {
                if (Array.isArray(stateConfig.mask)) {
                    mask = stateConfig.mask[i];
                } else {
                    mask = stateConfig.mask;
                }
            }
            if ((packet[offset + i] & mask) !== (stateConfig.data[i] & mask)) {
                return false;
            }
        }

        return true;
    }
}
