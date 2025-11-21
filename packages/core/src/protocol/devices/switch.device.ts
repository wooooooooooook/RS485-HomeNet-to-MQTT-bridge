import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class SwitchDevice extends GenericDevice {
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

        const offset = schema.offset || 0;
        if (packet.length < offset + schema.data.length) return false;

        for (let i = 0; i < schema.data.length; i++) {
            if (packet[offset + i] !== schema.data[i]) {
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
