import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class LightDevice extends GenericDevice {
    constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
        super(config, protocolConfig);
    }

    public parseData(packet: number[]): Record<string, any> | null {
        // First try lambda parsing from GenericDevice
        const updates = super.parseData(packet) || {};
        const entityConfig = this.config as any;

        // Handle state_on / state_off schemas if defined and not lambdas
        // This is a simplified implementation. A robust one would use a shared SchemaMatcher.
        // For now, we check if packet matches 'state_on' or 'state_off' data patterns.

        if (!updates.state) {
            if (this.matchesSchema(packet, entityConfig.state_on)) {
                updates.state = 'ON';
            } else if (this.matchesSchema(packet, entityConfig.state_off)) {
                updates.state = 'OFF';
            }
        }

        return Object.keys(updates).length > 0 ? updates : null;
    }

    private matchesSchema(packet: number[], schema: any): boolean {
        if (!schema || !schema.data) return false;

        // Check offset
        const offset = schema.offset || 0;
        if (packet.length < offset + schema.data.length) return false;

        // Check data match
        for (let i = 0; i < schema.data.length; i++) {
            if (packet[offset + i] !== schema.data[i]) {
                return false;
            }
        }
        return true;
    }

    public constructCommand(commandName: string, value?: any): number[] | null {
        // Try GenericDevice first (lambdas)
        const cmd = super.constructCommand(commandName, value);
        if (cmd) return cmd;

        // Handle standard commands if not lambda
        const entityConfig = this.config as any;
        if (commandName === 'on' && entityConfig.command_on?.data) {
            return [...entityConfig.command_on.data];
        }
        if (commandName === 'off' && entityConfig.command_off?.data) {
            return [...entityConfig.command_off.data];
        }

        return null;
    }
}
