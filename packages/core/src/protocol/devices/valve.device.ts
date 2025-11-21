import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class ValveDevice extends GenericDevice {
    constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
        super(config, protocolConfig);
    }

    public parseData(packet: number[]): Record<string, any> | null {
        if (!this.matchesPacket(packet)) {
            return null;
        }
        const updates = super.parseData(packet) || {};
        const entityConfig = this.config as any;

        if (!updates.state) {
            if (this.matchesSchema(packet, entityConfig.state_open)) {
                updates.state = 'OPEN';
            } else if (this.matchesSchema(packet, entityConfig.state_closed)) {
                updates.state = 'CLOSED';
            }
        }

        return Object.keys(updates).length > 0 ? updates : null;
    }

    private matchesSchema(packet: number[], schema: any): boolean {
        if (!schema || !schema.data) return false;
        const offset = schema.offset || 0;
        if (packet.length < offset + schema.data.length) return false;

        for (let i = 0; i < schema.data.length; i++) {
            const mask = schema.mask ? schema.mask[i] : 0xFF;
            if ((packet[offset + i] & mask) !== (schema.data[i] & mask)) {
                return false;
            }
        }
        return true;
    }

    public constructCommand(commandName: string, value?: any): number[] | null {
        const cmd = super.constructCommand(commandName, value);
        if (cmd) return cmd;

        const entityConfig = this.config as any;
        if (commandName === 'open' && entityConfig.command_open?.data) {
            return [...entityConfig.command_open.data];
        }
        if (commandName === 'close' && entityConfig.command_close?.data) {
            return [...entityConfig.command_close.data];
        }

        return null;
    }
}
