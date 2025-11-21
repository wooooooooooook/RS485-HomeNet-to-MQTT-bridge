import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class SensorDevice extends GenericDevice {
    constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
        super(config, protocolConfig);
    }

    public parseData(packet: number[]): Record<string, any> | null {
        if (!this.matchesPacket(packet)) {
            return null;
        }
        const updates = super.parseData(packet) || {};
        const entityConfig = this.config as any;

        // Handle generic state extraction if defined
        // e.g., state_number
        if (!updates.value && entityConfig.state_number) {
            const val = this.extractValue(packet, entityConfig.state_number);
            if (val !== null) updates.value = val;
        }

        return Object.keys(updates).length > 0 ? updates : null;
    }

    private extractValue(packet: number[], schema: any): number | null {
        if (!schema) return null;
        const offset = schema.offset || 0;
        const length = schema.length || 1;

        if (packet.length < offset + length) return null;

        let value = 0;
        if (length === 1) {
            value = packet[offset];
        } else {
            value = packet[offset]; // TODO: Multi-byte
        }

        return value;
    }

    public constructCommand(commandName: string, value?: any): number[] | null {
        return super.constructCommand(commandName, value);
    }
}
