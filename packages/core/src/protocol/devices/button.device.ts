import { GenericDevice } from './generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../types.js';

export class ButtonDevice extends GenericDevice {
    constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
        super(config, protocolConfig);
    }

    public parseData(packet: number[]): Record<string, any> | null {
        // Buttons usually don't have state, but might receive ACKs or events
        return super.parseData(packet);
    }

    public constructCommand(commandName: string, value?: any): number[] | null {
        const cmd = super.constructCommand(commandName, value);
        if (cmd) return cmd;

        const entityConfig = this.config as any;
        if (commandName === 'on' && entityConfig.command_on?.data) {
            return [...entityConfig.command_on.data];
        }

        return null;
    }
}
