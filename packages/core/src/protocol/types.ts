export type ChecksumType = 'add' | 'xor' | 'add_no_header' | 'xor_no_header' | 'xor_add' | 'samsung_rx' | 'samsung_tx' | 'none';
export type DecodeEncodeType = 'none' | 'bcd' | 'ascii' | 'signed_byte_half_degree' | 'multiply' | 'add_0x80';
export type EndianType = 'big' | 'little';

export interface PacketDefaults {
    tx_header?: number[];
    tx_footer?: number[];
    tx_checksum?: ChecksumType | { type: 'custom'; algorithm: string };
    rx_header?: number[];
    rx_footer?: number[];
    rx_checksum?: ChecksumType | { type: 'custom'; algorithm: string };
    rx_length?: number;
}

export interface StateSchema {
    data?: number[];
    mask?: number | number[];
    offset?: number;
    inverted?: boolean;
}

export interface StateLambdaConfig {
    conditions?: {
        extractor: Extractor;
        value: any;
        then: any;
    }[];
    valueSource?: ValueSource;
    valueMappings?: {
        map: number | string;
        value: number | string | boolean;
    }[];
}

export interface StateNumSchema extends StateSchema {
    length?: number;
    precision?: number;
    signed?: boolean;
    endian?: EndianType;
    decode?: DecodeEncodeType;
    homenet_logic?: StateLambdaConfig;
    mapping?: { [key: number]: string | number };
}

export interface ValueSource {
    type: 'input' | 'entity_state' | 'packet';
    entityId?: string;
    property?: string;
    offset?: number;
    length?: number;
    precision?: number;
    signed?: boolean;
    endian?: EndianType;
    decode?: DecodeEncodeType;
}

export interface Extractor {
    type: 'check_value' | 'offset_value';
    offset?: number;
    value?: number;
    length?: number;
    precision?: number;
    signed?: boolean;
    endian?: EndianType;
    decode?: DecodeEncodeType;
}
