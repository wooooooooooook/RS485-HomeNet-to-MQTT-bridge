import { DecodeEncodeType, EndianType } from '../../protocol/types.js';

export interface CommandSchema {
  data?: number[];
  cmd?: number[];
  value_offset?: number;
  value_encode?: DecodeEncodeType;
  length?: number;
  signed?: boolean;
  endian?: EndianType;
  multiply_factor?: number;
  low_priority?: boolean;
}

export interface EntityConfig {
  id: string;
  name: string;
  type: string;
  unique_id?: string;
  device?: string;
  area?: string;
  packet_parameters?: any;
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: string;
  icon?: string;
  discovery_always?: boolean;
  discovery_linked_id?: string;
  optimistic?: boolean;
}
