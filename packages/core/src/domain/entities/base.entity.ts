import { DecodeEncodeType, EndianType, ValueSource, Extractor } from '../../protocol/types.js';
import { StateLambdaConfig } from '../../protocol/types.js';
export type { StateLambdaConfig };

export interface CommandSchema {
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
    packet_parameters?: any;
}
