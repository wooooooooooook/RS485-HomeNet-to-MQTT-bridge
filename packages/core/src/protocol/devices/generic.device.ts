import { Device } from '../device.js';
import { DeviceConfig, ProtocolConfig, LambdaConfig } from '../types.js';
import { LambdaExecutor } from '../lambda-executor.js';

export class GenericDevice extends Device {
    private lambdaExecutor: LambdaExecutor;

    constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
        super(config, protocolConfig);
        this.lambdaExecutor = new LambdaExecutor();
    }

    public parseData(packet: number[]): Record<string, any> | null {
        const entityConfig = this.config as any;
        const updates: Record<string, any> = {};
        let hasUpdates = false;

        // Check for state lambdas
        for (const key in entityConfig) {
            if (key.startsWith('state_') && entityConfig[key]?.type === 'lambda') {
                const lambda = entityConfig[key] as LambdaConfig;
                const result = this.lambdaExecutor.execute(lambda, {
                    data: packet,
                    x: null // No previous value for state extraction usually
                });

                if (result !== undefined && result !== null && result !== '') {
                    // Remove 'state_' prefix
                    const stateKey = key.replace('state_', '');
                    updates[stateKey] = result;
                    hasUpdates = true;
                }
            }
        }

        // Fallback to schema-based extraction if no lambda matched or as addition
        // This is where we would use the schema to extract data
        // For now, let's assume simple state extraction based on 'state' property in config if it exists
        // The actual config structure for entities is in EntityConfig, which extends DeviceConfig (sort of)

        // Example logic: check if packet matches 'state' pattern
        if (entityConfig.state && entityConfig.state.data) {
            // Check if packet contains the data pattern
            // This is a simplification. Uartex has complex matching logic.
            // For this refactor, we might need to implement a robust matcher.
        }

        return hasUpdates ? updates : null;
    }

    public constructCommand(commandName: string, value?: any): number[] | null {
        const entityConfig = this.config as any;
        const commandConfig = entityConfig[`command_${commandName}`];

        if (commandConfig) {
            if (commandConfig.type === 'lambda') {
                const lambda = commandConfig as LambdaConfig;
                const result = this.lambdaExecutor.execute(lambda, {
                    x: value,
                    data: [], // No packet data for command construction
                    state: this.getState() || {}
                });

                if (Array.isArray(result)) {
                    // Result might be array of arrays (packet + ack + mask) or just packet
                    // Uartex returns {{packet}, {ack}, {mask}}
                    // We need to handle this. For now assuming it returns just the packet data or the first element if array of arrays.
                    if (Array.isArray(result[0])) {
                        return result[0];
                    }
                    return result;
                }
            } else if (commandConfig.data) {
                return [...commandConfig.data];
            }
        }

        return null;
    }
}
