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
  timestampMs?: number;
  timeLabel?: string;
  searchText?: string;
};

export type StateChangeEvent = {
  entityId: string;
  topic: string;
  payload: string;
  state: Record<string, unknown>;
  timestamp: string;
  portId?: string;
};

export type EntityErrorEvent = {
  entityId: string;
  portId?: string;
  type: 'parse' | 'cel' | 'command';
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
};

export type FrontendSettings = {
  toast: {
    stateChange: boolean;
    command: boolean;
  };
  activityLog?: {
    hideAutomationScripts: boolean;
  };
  locale?: string;
  logRetention?: LogRetentionSettings;
  editor?: {
    default: 'monaco' | 'textarea';
  };
};

export type LogRetentionSettings = {
  enabled: boolean;
  autoSaveEnabled: boolean;
  retentionCount: number;
  ttlHours: number;
};

export type LogRetentionStats = {
  enabled: boolean;
  packetLogCount: number;
  unparsedValidPacketCount: number;
  activityLogCount: number;
  memoryUsageBytes: number;
  oldestLogTimestamp: number | null;
};

export type PacketDictionaryFullResponse = {
  dictionary: Record<string, string>;
  unmatchedPackets: string[];
  parsedPacketEntities: Record<string, string[]>;
  stats: LogRetentionStats;
};

export type SavedLogFile = {
  filename: string;
  size: number;
  createdAt: string;
};

export type BackupFile = {
  filename: string;
  size: number;
  createdAt: string;
};

export interface ActivityLog {
  timestamp: number;
  code: string;
  params?: Record<string, any>;
  // Optional fallback message for legacy or non-i18n clients
  message?: string;
  portId?: string;
}

export type BridgeStatus = 'idle' | 'starting' | 'started' | 'stopped' | 'error' | 'reconnecting';
export type BridgeErrorSource = 'serial' | 'core' | 'mqtt' | 'service';
export type BridgeErrorSeverity = 'error' | 'warning';

export type BridgeErrorPayload = {
  code: string;
  message?: string;
  detail?: string;
  source: BridgeErrorSource;
  portId?: string;
  severity: BridgeErrorSeverity;
  retryable?: boolean;
  timestamp: string;
};

export type BridgeSerialInfo = {
  portId: string;
  path: string;
  baudRate: number;
  topic: string;
};

export type BridgeEntry = {
  configFile: string;
  serial: BridgeSerialInfo | null;
  mqttTopicPrefix: string;
  topic: string;
  error?: string;
  errorInfo?: BridgeErrorPayload | null;
  status: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
};

export type BridgeInfo = {
  configFiles: string[];
  bridges: BridgeEntry[];
  mqttUrl: string;
  status: BridgeStatus;
  error?: string | null;
  errorInfo?: BridgeErrorPayload | null;
  topic: string;
  restartRequired?: boolean;
  timezone?: string;
};

export type CommandInfo = {
  entityId: string;
  entityName: string;
  entityType: string;
  commandName: string;
  displayName: string;
  inputType?: 'number' | 'text' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  configFile?: string;
  portId?: string;
  discoveryAlways?: boolean;
  discoveryLinkedId?: string;
};

export type ConfigEntitySummary = {
  entityId: string;
  entityName: string;
  entityType: string;
  portId?: string;
  configFile?: string;
  discoveryAlways?: boolean;
  discoveryLinkedId?: string;
};

export type EntityCategory = 'entity' | 'automation' | 'script';

export type AutomationSummary = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  configFile?: string;
};

export type ScriptSummary = {
  id: string;
  description?: string;
  configFile?: string;
};

export type RawPacketWithInterval = {
  payload: string;
  receivedAt: string;
  interval: number | null;
  portId?: string;
  direction?: 'RX' | 'TX';
};

export type PacketStatsData = {
  packetAvg: number;
  packetStdDev: number;
  idleAvg: number;
  idleStdDev: number;
  idleOccurrenceAvg: number;
  idleOccurrenceStdDev: number;
  sampleSize: number;
  portId?: string;
};

export type PacketStats = PacketStatsData & {
  valid?: PacketStatsData;
};

export type UnifiedEntity = {
  id: string;
  displayName: string;
  type?: string;
  category?: EntityCategory;
  description?: string;
  enabled?: boolean;
  statePayload?: string;
  commands: CommandInfo[];
  isStatusDevice: boolean;
  portId?: string;
  discoveryAlways?: boolean;
  discoveryLinkedId?: string;
  isActive?: boolean;
  errorCount?: number;
};

export type PacketAnalysisEntityMatch = {
  entityId: string;
  entityName: string;
  entityType: string;
  state: Record<string, unknown>;
};

export type PacketAnalysisPacket = {
  hex: string;
  bytes: number[];
  matches: PacketAnalysisEntityMatch[];
};

export type PacketAnalysisUnmatchedPacket = {
  hex: string;
  bytes: number[];
};

export type PacketAnalysisAutomationMatch = {
  automationId: string;
  name?: string;
  description?: string;
  triggerType: 'packet' | 'state';
  triggerIndex: number;
  packetIndex: number;
  packetHex: string;
  entityId?: string;
  property?: string;
  matchedValue?: unknown;
};

export type PacketAnalysisResult = {
  packets: PacketAnalysisPacket[];
  unmatchedPackets: PacketAnalysisUnmatchedPacket[];
  automationMatches: PacketAnalysisAutomationMatch[];
  errors: string[];
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
  timestampMs?: number;
  timeLabel?: string;
  searchText?: string;
};

export type ToastMessage = {
  id: string;
  type: 'state' | 'command';
  title: string;
  message: string;
  timestamp: string;
};

export type StatusMessage = {
  key: string;
  values?: Record<string, any>;
};

// Optimized packet log types (with packetId instead of resolved packet string)
export type PacketLogEntry = {
  packetId: string;
  entityId: string;
  state: unknown;
  timestamp: string;
  portId?: string;
  timestampMs?: number;
  timeLabel?: string;
  searchText?: string;
};

export type CommandLogEntry = {
  packetId: string;
  entity: string;
  entityId: string;
  command: string;
  value?: unknown;
  timestamp: string;
  portId?: string;
  timestampMs?: number;
  timeLabel?: string;
  searchText?: string;
};

export type PacketHistoryResponse<T> = {
  dictionary: Record<string, string>;
  logs: T[];
};

// Gallery types
export interface GalleryContentSummary {
  entities: Record<string, number>;
  automations: number;
  scripts?: number;
}

export interface GallerySchemaField {
  type: 'integer' | 'string' | 'boolean';
  min?: number;
  max?: number;
  label?: string;
  label_en?: string;
  description?: string;
  description_en?: string;
}

export interface GalleryParameterDefinition {
  name: string;
  type: 'integer' | 'string' | 'integer[]' | 'object[]';
  default?: unknown;
  min?: number;
  max?: number;
  label?: string;
  label_en?: string;
  description?: string;
  description_en?: string;
  schema?: Record<string, GallerySchemaField>;
}

export interface GalleryItem {
  file: string;
  name: string;
  name_en?: string;
  description: string;
  description_en?: string;
  version: string;
  author: string;
  tags: string[];
  parameters?: GalleryParameterDefinition[];
  content_summary: GalleryContentSummary;
}

export interface GalleryDiscoveryResult {
  matched: boolean;
  matchedPacketCount: number;
  parameterValues: Record<string, unknown>;
  ui?: {
    label?: string;
    label_en?: string;
    badge?: string;
    summary?: string;
    summary_en?: string;
  };
}

export interface GalleryMatchCandidate {
  matchId: string;
  similarity: number;
  existingYaml?: string;
}

export interface GalleryMatch {
  type: 'entity';
  entityType?: string;
  id: string;
  matchedId: string;
  existingYaml: string;
  newYaml: string;
  similarity?: number;
  candidates?: GalleryMatchCandidate[];
}

export interface GalleryVendorRequirements {
  serial?: Record<string, unknown>;
  packet_defaults?: Record<string, unknown>;
}

export interface GalleryVendor {
  id: string;
  name: string;
  requirements?: GalleryVendorRequirements;
  items: GalleryItem[];
}

export interface GalleryData {
  generated_at: string;
  vendors: GalleryVendor[];
}

// Extended item types for UI components
export type GalleryItemWithVendor = GalleryItem & {
  vendorId: string;
  vendorName: string;
  vendorRequirements?: GalleryVendorRequirements;
};

export type GalleryItemForPreview = GalleryItem & {
  vendorId: string;
  vendorRequirements?: GalleryVendorRequirements;
};
