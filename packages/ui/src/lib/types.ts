export type MqttMessageEvent = {
  topic: string;
  payload: string;
  receivedAt: string;
};

export type CommandPacket = {
  entity: string;
  entityId: string;
  command: string;
  value: any;
  packet: string;
  timestamp: string;
  portId?: string;
};

export type StateChangeEvent = {
  entityId: string;
  topic: string;
  payload: string;
  state: Record<string, unknown>;
  timestamp: string;
  portId?: string;
};

export type FrontendSettings = {
  toast: {
    stateChange: boolean;
    command: boolean;
  };
};

export interface ActivityLog {
  timestamp: number;
  message: string;
  details?: any;
}

export type BridgeStatus = 'idle' | 'starting' | 'started' | 'stopped' | 'error';

export type BridgeSerialInfo = {
  portId: string;
  path: string;
  baudRate: number;
  topic: string;
};

export type BridgeEntry = {
  configFile: string;
  serials: BridgeSerialInfo[];
  mqttTopicPrefix: string;
  topic: string;
};

export type BridgeInfo = {
  configFiles: string[];
  bridges: BridgeEntry[];
  mqttUrl: string;
  status: BridgeStatus;
  error?: string | null;
  topic: string;
};

export type CommandInfo = {
  entityId: string;
  entityName: string;
  entityType: string;
  commandName: string;
  displayName: string;
  inputType?: 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  configFile?: string;
  portId?: string;
};

export type RawPacketWithInterval = {
  topic: string;
  payload: string;
  receivedAt: string;
  interval: number | null;
  portId?: string;
};

export type PacketStats = {
  packetAvg: number;
  packetStdDev: number;
  idleAvg: number;
  idleStdDev: number;
  idleOccurrenceAvg: number;
  idleOccurrenceStdDev: number;
  sampleSize: number;
  portId?: string;
};

export type UnifiedEntity = {
  id: string;
  displayName: string;
  type?: string;
  statePayload?: string;
  commands: CommandInfo[];
  isStatusDevice: boolean;
  portId?: string;
};

export type ParsedPayloadEntry = {
  key: string;
  value: string;
};

export type ParsedPacket = {
  entityId: string;
  packet: string; // hex string
  state: any;
  timestamp: string;
  portId?: string;
};

export type ToastMessage = {
  id: string;
  type: 'state' | 'command';
  title: string;
  message: string;
  timestamp: string;
};
