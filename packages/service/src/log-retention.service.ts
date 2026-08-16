import { eventBus } from '@rs485-homenet/core';
import { logger } from '@rs485-homenet/core';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { resolveSecurePath, getLocalTimestamp } from './utils/helpers.js';

const DEFAULT_TTL_HOURS = 1;
const MAX_CLEANUP_INTERVAL = 60 * 60 * 1000; // Cleanup at least every hour

export interface LogRetentionSettings {
  enabled: boolean;
  autoSaveEnabled: boolean;
  retentionCount: number;
  ttlHours: number;
}

export interface LogRetentionStats {
  enabled: boolean;
  packetLogCount: number;
  unparsedValidPacketCount: number;
  activityLogCount: number;
  interfaceLogCount: number;
  memoryUsageBytes: number;
  oldestLogTimestamp: number | null;
}

export interface SavedLogFile {
  filename: string;
  size: number;
  createdAt: string;
}

export type PacketLogEntry = {
  packetId: string;
  entityId: string;
  state: unknown;
  timestamp: string;
  portId?: string;
};

export type CommandLogEntry = {
  packetId: string;
  entity: string;
  entityId: string;
  command: string;
  value?: unknown;
  timestamp: string;
  portId?: string;
};

type ActivityLogEntry = {
  timestamp: number;
  code: string;
  params?: Record<string, unknown>;
  portId?: string;
};

export interface InterfaceLogEntry {
  timestamp: string;
  integration: 'mqtt' | 'matter';
  direction: 'in' | 'out';
  topicOrEntityId: string;
  payload: string;
  portId?: string;
}

export class LogRetentionService {
  private enabled: boolean = true;
  private autoSaveEnabled: boolean = false;
  private retentionCount: number = 7;
  private ttlHours: number = DEFAULT_TTL_HOURS;
  private logsSubDir: string;

  // Cached logs
  private parsedPacketLogs: PacketLogEntry[] = [];
  private commandPacketLogs: CommandLogEntry[] = [];
  private activityLogs: ActivityLogEntry[] = [];
  private interfaceLogs: InterfaceLogEntry[] = [];

  // Dictionary for valid but unparsed packets (Map: portId -> Set<packet hex>)
  private validButUnparsedPackets = new Map<string, Set<string>>();

  // Timers
  private cleanupTimer: NodeJS.Timeout | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;

  // Packet dictionary reference (shared with server.ts)
  private packetDictionary: Map<string, string>;
  private packetDictionaryReverse: Map<string, string>;
  private packetIdCounter = 0;

  constructor(
    configDir: string,
    packetDictionary?: Map<string, string>,
    packetDictionaryReverse?: Map<string, string>,
  ) {
    this.logsSubDir = path.join(configDir, 'cache-logs');
    this.packetDictionary = packetDictionary || new Map<string, string>();
    this.packetDictionaryReverse = packetDictionaryReverse || new Map<string, string>();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public async init(settings?: Partial<LogRetentionSettings>) {
    if (settings) {
      this.enabled = settings.enabled ?? this.enabled;
      this.autoSaveEnabled = settings.autoSaveEnabled ?? this.autoSaveEnabled;
      this.retentionCount = settings.retentionCount ?? this.retentionCount;
      if (typeof settings.ttlHours === 'number' && settings.ttlHours > 0) {
        this.ttlHours = settings.ttlHours;
      }
    }

    // Start cleanup timer
    this.startCleanupTimer();

    // Setup event listeners if enabled
    if (this.enabled) {
      this.setupListeners();
    }

    // Setup auto-save if enabled
    if (this.autoSaveEnabled) {
      this.startAutoSave();
    }

    logger.info(
      `[LogRetention] Initialized. Enabled: ${this.enabled}, AutoSave: ${this.autoSaveEnabled}, TTL: ${this.ttlHours}h`,
    );
  }

  public getSettings(): LogRetentionSettings {
    return {
      enabled: this.enabled,
      autoSaveEnabled: this.autoSaveEnabled,
      retentionCount: this.retentionCount,
      ttlHours: this.ttlHours,
    };
  }

  // Getters for packet history (for API endpoints)
  public getCommandPacketHistory(): Array<{
    entity: string;
    entityId: string;
    command: string;
    value?: unknown;
    packet: string;
    timestamp: string;
    portId?: string;
  }> {
    return this.commandPacketLogs.map((log) => ({
      entity: log.entity,
      entityId: log.entityId,
      command: log.command,
      value: log.value,
      packet: this.packetDictionaryReverse.get(log.packetId) || '',
      timestamp: log.timestamp,
      portId: log.portId,
    }));
  }

  public getParsedPacketHistory(): Array<{
    entityId: string;
    packet: string;
    state: unknown;
    timestamp: string;
    portId?: string;
  }> {
    return this.parsedPacketLogs.map((log) => ({
      entityId: log.entityId,
      packet: this.packetDictionaryReverse.get(log.packetId) || '',
      state: log.state,
      timestamp: log.timestamp,
      portId: log.portId,
    }));
  }

  // Optimized: Return raw logs with packetId instead of resolved packet string
  public getParsedPacketHistoryRaw(): PacketLogEntry[] {
    return this.parsedPacketLogs;
  }

  public getCommandPacketHistoryRaw(): CommandLogEntry[] {
    return this.commandPacketLogs;
  }

  public getInterfaceLogs(portId?: string): InterfaceLogEntry[] {
    if (!portId) return this.interfaceLogs;
    return this.interfaceLogs.filter((log) => log.portId === portId);
  }

  public getPacketDictionary(portId?: string): Record<string, string> {
    // If no portId filter, return all dictionary entries
    if (!portId) {
      const dict: Record<string, string> = {};
      this.packetDictionaryReverse.forEach((payload, id) => {
        dict[id] = payload;
      });
      return dict;
    }

    // Collect packet IDs used by this port
    const usedPacketIds = new Set<string>();
    for (const log of this.parsedPacketLogs) {
      if (log.portId === portId) {
        usedPacketIds.add(log.packetId);
      }
    }
    for (const log of this.commandPacketLogs) {
      if (log.portId === portId) {
        usedPacketIds.add(log.packetId);
      }
    }

    const dict: Record<string, string> = {};
    for (const packetId of usedPacketIds) {
      const payload = this.packetDictionaryReverse.get(packetId);
      if (payload) {
        dict[packetId] = payload;
      }
    }
    return dict;
  }

  public getUnmatchedPackets(portId?: string): string[] {
    if (!portId) {
      // Return all unmatched packets from all ports
      const allPackets = new Set<string>();
      for (const packets of this.validButUnparsedPackets.values()) {
        for (const pkt of packets) {
          allPackets.add(pkt);
        }
      }
      return Array.from(allPackets);
    }
    const portPackets = this.validButUnparsedPackets.get(portId);
    return portPackets ? Array.from(portPackets) : [];
  }

  /**
   * Returns a mapping of packet hex -> array of entity IDs that parsed this packet
   * @param portId Optional port ID to filter packets by
   */
  public getParsedPacketEntities(portId?: string): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    const tempSets: Record<string, Set<string>> = {};

    const formatCommandLabel = (log: CommandLogEntry): string => {
      const base = `${log.entityId} (${log.command}`;
      if (log.value === undefined) {
        return `${base})`;
      }
      const valueLabel = typeof log.value === 'string' ? log.value : JSON.stringify(log.value);
      return `${base}: ${valueLabel})`;
    };

    for (const log of this.parsedPacketLogs) {
      // Filter by portId if specified
      if (portId && log.portId !== portId) continue;

      const packetHex = this.packetDictionaryReverse.get(log.packetId);
      if (!packetHex) continue;

      let set = tempSets[packetHex];
      if (!set) {
        set = new Set<string>();
        tempSets[packetHex] = set;
      }
      set.add(log.entityId);
    }

    for (const log of this.commandPacketLogs) {
      if (portId && log.portId !== portId) continue;

      const packetHex = this.packetDictionaryReverse.get(log.packetId);
      if (!packetHex) continue;

      let set = tempSets[packetHex];
      if (!set) {
        set = new Set<string>();
        tempSets[packetHex] = set;
      }
      set.add(formatCommandLabel(log));
    }

    for (const key in tempSets) {
      result[key] = Array.from(tempSets[key]);
    }

    return result;
  }

  public async updateSettings(
    settings: Partial<LogRetentionSettings>,
  ): Promise<LogRetentionSettings> {
    const wasEnabled = this.enabled;
    const wasAutoSaveEnabled = this.autoSaveEnabled;
    const previousTtlHours = this.ttlHours;

    if (typeof settings.enabled === 'boolean') {
      this.enabled = settings.enabled;
    }
    if (typeof settings.autoSaveEnabled === 'boolean') {
      this.autoSaveEnabled = settings.autoSaveEnabled;
    }
    if (typeof settings.retentionCount === 'number' && settings.retentionCount > 0) {
      this.retentionCount = settings.retentionCount;
    }
    if (typeof settings.ttlHours === 'number' && settings.ttlHours > 0) {
      this.ttlHours = settings.ttlHours;
    }

    // Handle enabled state change
    if (!wasEnabled && this.enabled) {
      this.setupListeners();
      logger.info('[LogRetention] Caching enabled, listeners registered');
    } else if (wasEnabled && !this.enabled) {
      this.removeListeners();
      this.clearLogs();
      logger.info('[LogRetention] Caching disabled, logs cleared');
    }

    // Handle auto-save state change
    if (!wasAutoSaveEnabled && this.autoSaveEnabled) {
      this.startAutoSave();
    } else if (wasAutoSaveEnabled && !this.autoSaveEnabled) {
      this.stopAutoSave();
    }
    if (previousTtlHours !== this.ttlHours) {
      this.startCleanupTimer();
      if (this.autoSaveEnabled) {
        this.startAutoSave();
      }
    }

    return this.getSettings();
  }

  public getStats(): LogRetentionStats {
    const memoryUsage = this.calculateMemoryUsage();
    const oldestTimestamp = this.getOldestLogTimestamp();

    return {
      enabled: this.enabled,
      packetLogCount: this.parsedPacketLogs.length + this.commandPacketLogs.length,
      unparsedValidPacketCount: this.validButUnparsedPackets.size,
      activityLogCount: this.activityLogs.length,
      interfaceLogCount: this.interfaceLogs.length,
      memoryUsageBytes: memoryUsage,
      oldestLogTimestamp: oldestTimestamp,
    };
  }

  private calculateMemoryUsage(): number {
    // Rough estimation of memory usage
    // Each log entry is estimated based on typical object sizes
    const packetLogSize = (this.parsedPacketLogs.length + this.commandPacketLogs.length) * 200; // ~200 bytes per entry
    const unparsedPacketSize = this.validButUnparsedPackets.size * 50; // ~50 bytes per unique packet
    const activityLogSize = this.activityLogs.length * 250; // ~250 bytes per entry
    const interfaceLogSize = this.interfaceLogs.length * 200; // ~200 bytes per entry

    // Dictionary overhead
    const dictSize = this.packetDictionary.size * 100; // ~100 bytes per entry

    return packetLogSize + unparsedPacketSize + activityLogSize + dictSize + interfaceLogSize;
  }

  private getOldestLogTimestamp(): number | null {
    const timestamps: number[] = [];

    if (this.parsedPacketLogs.length > 0) {
      timestamps.push(new Date(this.parsedPacketLogs[0].timestamp).getTime());
    }
    if (this.commandPacketLogs.length > 0) {
      timestamps.push(new Date(this.commandPacketLogs[0].timestamp).getTime());
    }
    if (this.activityLogs.length > 0) {
      timestamps.push(this.activityLogs[0].timestamp);
    }
    if (this.interfaceLogs.length > 0) {
      timestamps.push(new Date(this.interfaceLogs[0].timestamp).getTime());
    }

    return timestamps.length > 0 ? Math.min(...timestamps) : null;
  }

  private clearLogs(): void {
    this.parsedPacketLogs = [];
    this.commandPacketLogs = [];
    this.validButUnparsedPackets = new Map<string, Set<string>>();
    this.activityLogs = [];
    this.interfaceLogs = [];
  }

  private getOrCreatePacketId(packet: string): string {
    let packetId = this.packetDictionary.get(packet);
    if (!packetId) {
      // Use monotonic counter to ensure uniqueness even after pruning
      packetId = `p${++this.packetIdCounter}`;
      this.packetDictionary.set(packet, packetId);
      this.packetDictionaryReverse.set(packetId, packet);
    }
    return packetId;
  }

  private cleanupOldLogs(): void {
    if (!this.enabled) return;

    const cutoff = Date.now() - this.getTtlMs();

    this.parsedPacketLogs = this.parsedPacketLogs.filter(
      (log) => new Date(log.timestamp).getTime() >= cutoff,
    );

    this.commandPacketLogs = this.commandPacketLogs.filter(
      (log) => new Date(log.timestamp).getTime() >= cutoff,
    );

    this.activityLogs = this.activityLogs.filter((log) => log.timestamp >= cutoff);

    this.interfaceLogs = this.interfaceLogs.filter(
      (log) => new Date(log.timestamp).getTime() >= cutoff,
    );

    this.pruneDictionary();
  }

  private pruneDictionary(): void {
    const usedPacketIds = new Set<string>();

    // Collect all used packet IDs (validButUnparsedPackets stores raw hex, not packetId)
    this.parsedPacketLogs.forEach((log) => usedPacketIds.add(log.packetId));
    this.commandPacketLogs.forEach((log) => usedPacketIds.add(log.packetId));

    // Remove unused entries from dictionary
    for (const [packetId, payload] of this.packetDictionaryReverse.entries()) {
      if (!usedPacketIds.has(packetId)) {
        this.packetDictionaryReverse.delete(packetId);
        this.packetDictionary.delete(payload);
      }
    }
  }

  // Event handlers
  private handleParsedPacket = (packet: unknown) => {
    if (!this.enabled) return;

    const pkt = packet as {
      packet?: string;
      entityId?: string;
      state?: unknown;
      timestamp?: string;
      portId?: string;
    };
    if (!pkt.packet) return;

    const packetId = this.getOrCreatePacketId(pkt.packet);

    this.parsedPacketLogs.push({
      packetId,
      entityId: pkt.entityId || '',
      state: pkt.state,
      timestamp: pkt.timestamp ? getLocalTimestamp(pkt.timestamp) : getLocalTimestamp(),
      portId: pkt.portId,
    });
  };

  private handleCommandPacket = (packet: unknown) => {
    if (!this.enabled) return;

    const pkt = packet as {
      packet?: string;
      entity?: string;
      entityId?: string;
      command?: string;
      value?: unknown;
      timestamp?: string;
      portId?: string;
    };
    if (!pkt.packet) return;

    const packetId = this.getOrCreatePacketId(pkt.packet);

    this.commandPacketLogs.push({
      packetId,
      entity: pkt.entity || '',
      entityId: pkt.entityId || '',
      command: pkt.command || '',
      value: pkt.value,
      timestamp: pkt.timestamp ? getLocalTimestamp(pkt.timestamp) : getLocalTimestamp(),
      portId: pkt.portId,
    });
  };

  private handleActivityLog = (data: unknown) => {
    if (!this.enabled) return;

    const log = data as ActivityLogEntry;
    this.activityLogs.push(log);
  };

  private handleInterfaceLog = (data: unknown) => {
    if (!this.enabled) return;

    const log = data as InterfaceLogEntry;
    this.interfaceLogs.push({
      ...log,
      timestamp: log.timestamp ? getLocalTimestamp(log.timestamp) : getLocalTimestamp(),
    });
  };

  private handleUnmatchedPacket = (data: unknown) => {
    if (!this.enabled) return;

    const pkt = data as {
      packet?: string;
      timestamp?: string;
      portId?: string;
    };
    if (!pkt.packet) return;

    // Add the raw packet hex to the port-specific set (unique values only)
    const portKey = pkt.portId || 'unknown';
    let portSet = this.validButUnparsedPackets.get(portKey);
    if (!portSet) {
      portSet = new Set<string>();
      this.validButUnparsedPackets.set(portKey, portSet);
    }
    portSet.add(pkt.packet);
  };

  private setupListeners() {
    eventBus.on('parsed-packet', this.handleParsedPacket);
    eventBus.on('command-packet', this.handleCommandPacket);
    eventBus.on('activity-log:added', this.handleActivityLog);
    eventBus.on('unmatched-packet', this.handleUnmatchedPacket);
    eventBus.on('interface-log:added', this.handleInterfaceLog);
  }

  private removeListeners() {
    eventBus.off('parsed-packet', this.handleParsedPacket);
    eventBus.off('command-packet', this.handleCommandPacket);
    eventBus.off('activity-log:added', this.handleActivityLog);
    eventBus.off('unmatched-packet', this.handleUnmatchedPacket);
    eventBus.off('interface-log:added', this.handleInterfaceLog);
  }

  // Auto-save functionality
  private startAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    const ttlMs = this.getTtlMs();
    this.autoSaveTimer = setInterval(() => this.autoSave(), ttlMs);
    logger.info(`[LogRetention] Auto-save started (${this.ttlHours}h interval)`);
  }

  private stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    logger.info('[LogRetention] Auto-save stopped');
  }

  private async autoSave(): Promise<void> {
    if (!this.enabled || !this.autoSaveEnabled) return;

    try {
      const result = await this.saveToFile();
      logger.info(`[LogRetention] Auto-saved to ${result.filename}`);

      // Cleanup old files
      await this.cleanupOldFiles();
    } catch (error) {
      logger.error({ err: error }, '[LogRetention] Auto-save failed');
    }
  }

  public async saveToFile(): Promise<{ filename: string; path: string }> {
    // Ensure log directory exists
    await fsp.mkdir(this.logsSubDir, { recursive: true });

    const timestamp = getLocalTimestamp().replace(/[:.]/g, '-');
    const filename = `cache_log_${timestamp}.json`;
    const filePath = path.join(this.logsSubDir, filename);

    // Build packet dictionary for export
    const dict: Record<string, string> = {};
    this.packetDictionaryReverse.forEach((payload, id) => {
      dict[id] = payload;
    });

    // Convert validButUnparsedPackets Map to a serializable object
    const unmatchedByPort: Record<string, string[]> = {};
    for (const [portId, packets] of this.validButUnparsedPackets.entries()) {
      unmatchedByPort[portId] = Array.from(packets);
    }

    const data = {
      exportedAt: getLocalTimestamp(),
      stats: this.getStats(),
      packetDictionary: dict,
      parsedPacketLogs: this.parsedPacketLogs,
      commandPacketLogs: this.commandPacketLogs,
      validButUnparsedPackets: unmatchedByPort,
      activityLogs: this.activityLogs,
      interfaceLogs: this.interfaceLogs,
    };

    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

    return { filename, path: filePath };
  }

  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await this.listSavedFiles();

      if (files.length > this.retentionCount) {
        // Sort by creation date (oldest first)
        files.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        const toDelete = files.slice(0, files.length - this.retentionCount);
        await Promise.all(
          toDelete.map(async (file) => {
            const filePath = path.join(this.logsSubDir, file.filename);
            await fsp.unlink(filePath);
            logger.info(`[LogRetention] Deleted old cache log: ${file.filename}`);
          }),
        );
      }
    } catch (error) {
      logger.error({ err: error }, '[LogRetention] Failed to cleanup old files');
    }
  }

  public async listSavedFiles(): Promise<SavedLogFile[]> {
    try {
      await fsp.mkdir(this.logsSubDir, { recursive: true });
      const entries = await fsp.readdir(this.logsSubDir, { withFileTypes: true });

      const jsonEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
      const fileResults = await Promise.all(
        jsonEntries.map(async (entry) => {
          try {
            const filePath = path.join(this.logsSubDir, entry.name);
            const stat = await fsp.stat(filePath);
            return {
              filename: entry.name,
              size: stat.size,
              createdAt: stat.birthtime.toISOString(),
            };
          } catch {
            return null;
          }
        }),
      );

      const files: SavedLogFile[] = fileResults.filter((f): f is SavedLogFile => f !== null);

      // Sort by creation date (newest first)
      files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return files;
    } catch (error) {
      logger.error({ err: error }, '[LogRetention] Failed to list saved files');
      return [];
    }
  }

  public getFilePath(filename: string): string | null {
    return resolveSecurePath(this.logsSubDir, filename);
  }

  public async deleteFile(filename: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(filename);
      if (!filePath) {
        return false;
      }
      await fsp.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup log files based on mode
   * @param mode 'all' to delete all, 'keep_recent' to keep N most recent
   * @param keepCount Number of recent files to keep (only for 'keep_recent' mode)
   * @returns Number of deleted files
   */
  public async cleanupFiles(mode: 'all' | 'keep_recent', keepCount: number = 0): Promise<number> {
    const files = await this.listSavedFiles();
    // Files are already sorted by createdAt (newest first) from listSavedFiles
    const targets = mode === 'all' ? files : files.slice(Math.max(keepCount, 0));

    const results = await Promise.all(targets.map((file) => this.deleteFile(file.filename)));
    return results.filter(Boolean).length;
  }

  public destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.stopAutoSave();
    this.removeListeners();
  }

  private getTtlMs(): number {
    return this.ttlHours * 60 * 60 * 1000;
  }

  private getCleanupIntervalMs(): number {
    return Math.min(this.getTtlMs(), MAX_CLEANUP_INTERVAL);
  }

  private startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    const cleanupInterval = this.getCleanupIntervalMs();
    this.cleanupTimer = setInterval(() => this.cleanupOldLogs(), cleanupInterval);
    logger.info(`[LogRetention] Cleanup timer set (${cleanupInterval / 1000}s interval)`);
  }
}
