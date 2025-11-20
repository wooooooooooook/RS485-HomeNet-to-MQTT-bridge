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
}
