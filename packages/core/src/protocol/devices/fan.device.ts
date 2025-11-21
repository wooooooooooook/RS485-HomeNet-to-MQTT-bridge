import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class FanDevice extends GenericDevice {
    constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
        super(config, protocolConfig);
    }

    public parseData(packet: number[]): Record<string, any> | null {
        if (!this.matchesPacket(packet)) {
            return null;
        }
        const updates = super.parseData(packet) || {};
        const entityConfig = this.config as any;

        // Handle on/off if not lambda
        if (!updates.state) {
            if (this.matchesSchema(packet, entityConfig.state_on)) {
                updates.state = 'ON';
            } else if (this.matchesSchema(packet, entityConfig.state_off)) {
                updates.state = 'OFF';
            }
        }

        // Handle speed
        if (!updates.speed && entityConfig.state_speed) {
            const val = this.extractValue(packet, entityConfig.state_speed);
            if (val !== null) updates.speed = val;
        }

        return Object.keys(updates).length > 0 ? updates : null;
    }

    private extractValue(packet: number[], schema: any): number | null {
        if (!schema) return null;
        const offset = schema.offset || 0;
        if (packet.length < offset + 1) return null;
        return packet[offset];
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
        if (commandName === 'on' && entityConfig.command_on?.data) {
            return [...entityConfig.command_on.data];
        }
        if (commandName === 'off' && entityConfig.command_off?.data) {
            return [...entityConfig.command_off.data];
        }

        return null;
    }
}
