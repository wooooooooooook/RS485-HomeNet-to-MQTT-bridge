import { DecodeEncodeType, EndianType, PacketDefaults, StateSchema } from '../../protocol/types.js';

export interface CommandSchema {
  data?: number[];
  ack?: StateSchema | number[];

  value_offset?: number;
  value_encode?: DecodeEncodeType;
  length?: number;
  signed?: boolean;
  endian?: EndianType;
  multiply_factor?: number;
  low_priority?: boolean;
  script?: string;
}

/**
 * Command schema that can be either a structured schema object or a CEL expression string.
 * CEL expressions are evaluated at runtime to construct the command packet.
 * For commands, the CEL expression often constructs the raw bytes directly.
 */
export type CommandSchemaOrCEL = CommandSchema | string;

export interface EntityConfig {
  id: string;
  name: string;
  type?: string;
  unique_id?: string;
  device?: string;
  area?: string;
  packet_parameters?: PacketDefaults;
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: string;
  icon?: string;
  discovery_always?: boolean;
  discovery_linked_id?: string;
  optimistic?: boolean;
  internal?: boolean;

  /**
   * If true, this entity only parses state and updates the 'target_id' entity.
   * It will not be discovered or emit its own state updates.
   * Default internal: true.
   */
  state_proxy?: boolean;
  /**
   * Required if state_proxy is true. The ID of the entity to receive state updates.
   */
  target_id?: string;
}
