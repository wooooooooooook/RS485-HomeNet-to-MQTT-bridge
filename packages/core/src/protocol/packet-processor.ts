// packages/core/src/protocol/packet-processor.ts

import { HomenetBridgeConfig } from '../config/types.js';
import {
  EntityConfig,
} from '../domain/entities/base.entity.js';
import { CommandGenerator } from './generators/command.generator.js';
import { PacketParser } from './parsers/packet.parser.js';

export interface EntityStateProvider {
  getLightState(entityId: string): { isOn: boolean } | undefined;
  getClimateState(entityId: string): { targetTemperature: number } | undefined;
  // Add other entity types as needed
}

export class PacketProcessor {
  private commandGenerator: CommandGenerator;
  private packetParser: PacketParser;

  constructor(config: HomenetBridgeConfig, stateProvider: EntityStateProvider) {
    this.commandGenerator = new CommandGenerator(config, stateProvider);
    this.packetParser = new PacketParser(config, stateProvider);
  }

  public constructCommandPacket(
    entity: EntityConfig,
    commandName: string,
    value?: number | string,
  ): number[] | null {
    return this.commandGenerator.constructCommandPacket(entity, commandName, value);
  }

  // --- Packet Parsing ---
  public parseIncomingPacket(
    packet: number[],
    allEntities: EntityConfig[],
  ): { parsedStates: { entityId: string; state: any }[]; checksumValid: boolean } {
    return this.packetParser.parseIncomingPacket(packet, allEntities);
  }
}
