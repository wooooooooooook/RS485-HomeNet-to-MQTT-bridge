import { matchesPacket } from '../utils/packet-matching.js';
import {
  DeviceConfig,
  StateSchema,
  StateNumSchema,
  ProtocolConfig,
  CommandResult,
} from './types.js';
import { Buffer } from 'buffer';
import { extractFromSchema } from './schema-utils.js';

export abstract class Device {
  protected config: DeviceConfig;
  protected protocolConfig: ProtocolConfig;
  protected state: Record<string, any> = {};

  constructor(config: DeviceConfig, protocolConfig: ProtocolConfig) {
    this.config = config;
    this.protocolConfig = protocolConfig;
  }

  public abstract parseData(packet: Buffer): Record<string, any> | null;

  public abstract constructCommand(
    commandName: string,
    value?: any,
    states?: Map<string, Record<string, any>>,
  ): number[] | CommandResult | null;

  public getOptimisticState(commandName: string, value?: any): Record<string, any> | null {
    return null;
  }

  public getId(): string {
    return this.config.id;
  }

  public getName(): string {
    return this.config.name;
  }

  public getState(): Record<string, any> {
    return this.state;
  }

  protected updateState(newState: Record<string, any>) {
    this.state = { ...this.state, ...newState };
  }

  // Helper to extract data based on schema
  protected extractFromSchema(packet: Buffer, schema: StateSchema | StateNumSchema): any {
    return extractFromSchema(packet, schema);
  }

  public matchesPacket(packet: Buffer): boolean {
    const stateConfig = this.config.state;
    if (!stateConfig || !stateConfig.data) {
      // If no state config, we can't match based on state pattern.
      // However, some devices might be command-only or use other matching.
      // But for the purpose of "state update", we usually need a match.
      // Let's return false to be safe, preventing random updates.
      return false;
    }

    // offset이 명시되지 않은 경우에만 headerLength를 baseOffset으로 사용
    // offset이 명시된 경우(0 포함)는 헤더 포함 전체 패킷 기준
    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const baseOffset = stateConfig.offset === undefined ? headerLength : 0;

    return matchesPacket(stateConfig, packet, {
      baseOffset,
      context: { state: this.getState() },
    });
  }
}
