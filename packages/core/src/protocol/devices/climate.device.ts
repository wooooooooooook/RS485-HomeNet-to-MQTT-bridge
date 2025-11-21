import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class ClimateDevice extends GenericDevice {
    constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
        super(config, protocolConfig);
    }

    public parseData(packet: number[]): Record<string, any> | null {
        if (!this.matchesPacket(packet)) {
            return null;
        }
        const updates = super.parseData(packet) || {};
        const entityConfig = this.config as any;

        // Handle temperature extraction if not handled by lambda
        if (!updates.current_temperature && entityConfig.state_temperature_current) {
            const val = this.extractValue(packet, entityConfig.state_temperature_current);
            if (val !== null) updates.current_temperature = val;
        }

        if (!updates.target_temperature && entityConfig.state_temperature_target) {
            const val = this.extractValue(packet, entityConfig.state_temperature_target);
            if (val !== null) updates.target_temperature = val;
        }

        // Handle mode
        if (!updates.mode) {
            if (this.matchesSchema(packet, entityConfig.state_off)) {
                updates.mode = 'off';
            } else if (this.matchesSchema(packet, entityConfig.state_heat)) {
                updates.mode = 'heat';
            }
        }

        return Object.keys(updates).length > 0 ? updates : null;
    }

    private extractValue(packet: number[], schema: any): number | null {
        if (!schema) return null;
        const offset = schema.offset || 0;
        const length = schema.length || 1;

        if (packet.length < offset + length) return null;

        let value = 0;
        // Simple extraction for now, assuming 1 byte usually
        if (length === 1) {
            value = packet[offset];
        } else {
            // TODO: Handle multi-byte
            value = packet[offset];
        }

        if (schema.decode === 'bcd') {
            value = (value >> 4) * 10 + (value & 0x0F);
        }

        return value;
    }

    private matchesSchema(packet: number[], schema: any): boolean {
        if (!schema || !schema.data) return false;

        const offset = schema.offset || 0;
        if (packet.length < offset + schema.data.length) return false;

        for (let i = 0; i < schema.data.length; i++) {
            // Handle mask if present
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
        if (commandName === 'off' && entityConfig.command_off?.data) {
            return [...entityConfig.command_off.data];
        }
        if (commandName === 'heat' && entityConfig.command_heat?.data) {
            return [...entityConfig.command_heat.data];
        }

        // command_temperature is usually a lambda, handled by super

        return null;
    }
}
