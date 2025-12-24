import { EventEmitter } from 'node:events';
import { ProtocolConfig, PacketDefaults } from './types.js';
import { PacketParser } from './packet-parser.js';
import { Device } from './device.js';
import { logger } from '../utils/logger.js';
import { Buffer } from 'buffer';

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
    logger.debug(
      { deviceId: device.getId(), deviceName: device.getName() },
      '[ProtocolManager] Device registered',
    );
  }

  public getDevice(id: string): Device | undefined {
    return this.devices.find((d) => d.getId() === id);
  }

  public handleIncomingByte(byte: number): void {
    const packet = this.parser.parse(byte);
    if (packet) {
      this.processPacket(packet);
    }
  }

  public handleIncomingChunk(chunk: Buffer): void {
    const packets = this.parser.parseChunk(chunk);
    for (const packet of packets) {
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

  private processPacket(packet: Buffer) {
    // Optimization: Efficient hex logging without intermediate string array allocation
    const packetHex = packet.toString('hex').replace(/../g, '0x$& ').trim();

    // Compatibility: Convert Buffer to number[] for downstream devices expecting it.
    // This maintains backward compatibility with the Device.parseData(number[]) signature
    // while allowing efficient processing up to this point.
    // NOTE: This is the only allocation point now (reduced from 2+ allocations).
    const packetArray = [...packet];

    this.emit('packet', packetArray);

    let matchedAny = false;

    for (const device of this.devices) {
      const stateUpdates = device.parseData(packetArray);
      if (stateUpdates) {
        matchedAny = true;
        const stateStr = JSON.stringify(stateUpdates).replace(/["{}]/g, '').replace(/,/g, ', ');
        logger.debug(
          `[ProtocolManager] ${device.getId()} (${device.getName()}): ${packetHex} → {${stateStr}}`,
        );
        this.emit('state', { deviceId: device.getId(), state: stateUpdates });
        this.emit('parsed-packet', {
          deviceId: device.getId(),
          packet: packetArray,
          state: stateUpdates,
        });
      }
    }

    if (!matchedAny) {
      logger.debug(`[ProtocolManager] Packet not matched: ${packetHex}`);
    }
  }
}
