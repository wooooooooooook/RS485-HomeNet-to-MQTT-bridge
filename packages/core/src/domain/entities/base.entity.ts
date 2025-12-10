import { DecodeEncodeType, EndianType, ValueSource, Extractor } from '../../protocol/types.js';
import { StateLambdaConfig } from '../../protocol/types.js';
export type { StateLambdaConfig };

export interface CommandSchema {
  data?: number[];
  cmd?: number[];
  value_offset?: number;
  value_encode?: DecodeEncodeType;
  length?: number;
  signed?: boolean;
  endian?: EndianType;
  multiply_factor?: number;
  homenet_logic?: CommandLambdaConfig;
}

export interface CommandLambdaConfig {
  conditions?: {
    entityId: string;
    property: string;
    value: any;
    then: CommandLambdaConfig;
    else?: CommandLambdaConfig;
  }[];
  packetTemplates: {
    data: number[];
    conditions?: {
      entityId?: string;
      property?: string;
      extractor?: Extractor;
      value: any;
    }[];
    valueInsertions?: {
      valueOffset: number;
      value?: any;
      valueSource?: ValueSource;
      valueEncode: DecodeEncodeType;
      length: number;
      signed?: boolean;
      endian?: EndianType;
    }[];
  }[];
}

export interface EntityConfig {
  id: string;
  name: string;
  type: string;
  device?: string;
  area?: string;
  packet_parameters?: any;
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: string;
  icon?: string;
  discovery_always?: boolean;
  discovery_linked_id?: string;
}
