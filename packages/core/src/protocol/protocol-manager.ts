import { EventEmitter } from 'node:events';
import { ProtocolConfig, PacketDefaults } from './types.js';
import { PacketParser } from './packet-parser.js';
import { Device } from './device.js';
import { logger } from '../utils/logger.js';

export class ProtocolManager extends EventEmitter {
    private parser: PacketParser;
    private devices: Device[] = [];
    private config: ProtocolConfig;
    private txQueue: number[][] = [];
    private txQueueLowPriority: number[][] = [];
    private lastTxTime: number = 0;

    constructor(config: ProtocolConfig) {
        super();
        this.config = config;
        this.parser = new PacketParser(config.packet_defaults || {});
    }

    public registerDevice(device: Device) {
        this.devices.push(device);
        logger.debug({ deviceId: device.getId(), deviceName: device.getName() }, '[ProtocolManager] Device registered');
    }

    public handleIncomingByte(byte: number): void {
        const packet = this.parser.parse(byte);
        if (packet) {
            logger.debug({ packet: packet.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ') }, '[ProtocolManager] Packet parsed');
            this.processPacket(packet);
        }
    }

    public queueCommand(command: number[], highPriority: boolean = true) {
        if (highPriority) {
            this.txQueue.push(command);
        } else {
            this.txQueueLowPriority.push(command);
        }
    }

    public getNextCommand(): number[] | null {
        const now = Date.now();
        const txDelay = this.config.packet_defaults?.tx_delay || 50;

        if (now - this.lastTxTime < txDelay) {
            return null;
        }

        let command: number[] | undefined;

        if (this.txQueue.length > 0) {
            command = this.txQueue.shift();
        } else if (this.txQueueLowPriority.length > 0) {
            command = this.txQueueLowPriority.shift();
        }

        if (command) {
            this.lastTxTime = now;
            return command;
        }

        return null;
    }

    private processPacket(packet: number[]) {
        let matchedAny = false;
        for (const device of this.devices) {
            const stateUpdates = device.parseData(packet);
            if (stateUpdates) {
                matchedAny = true;
                logger.debug({
                    deviceId: device.getId(),
                    deviceName: device.getName(),
                    stateUpdates
                }, '[ProtocolManager] Device matched packet');
                this.emit('state', { deviceId: device.getId(), state: stateUpdates });
            }
        }

        if (!matchedAny) {
            logger.debug({
                packet: packet.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')
            }, '[ProtocolManager] No device matched this packet');
        }
    }
}
