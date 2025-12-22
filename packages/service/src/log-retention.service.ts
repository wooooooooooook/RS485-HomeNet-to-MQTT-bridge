import { eventBus } from '@rs485-homenet/core';
import { logger } from '@rs485-homenet/core';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const LOG_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const CLEANUP_INTERVAL = 60 * 60 * 1000; // Cleanup every hour
const AUTO_SAVE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

export interface LogRetentionSettings {
    enabled: boolean;
    autoSaveEnabled: boolean;
    retentionCount: number;
}

export interface LogRetentionStats {
    enabled: boolean;
    packetLogCount: number;
    activityLogCount: number;
    memoryUsageBytes: number;
    oldestLogTimestamp: number | null;
}

export interface SavedLogFile {
    filename: string;
    size: number;
    createdAt: string;
}

type PacketLogEntry = {
    packetId: string;
    entityId: string;
    state: unknown;
    timestamp: string;
    portId?: string;
};

type CommandLogEntry = {
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

export class LogRetentionService {
    private enabled: boolean = false;
    private autoSaveEnabled: boolean = false;
    private retentionCount: number = 7;
    private configDir: string;
    private logsSubDir: string;

    // Cached logs
    private parsedPacketLogs: PacketLogEntry[] = [];
    private commandPacketLogs: CommandLogEntry[] = [];
    private activityLogs: ActivityLogEntry[] = [];

    // Timers
    private cleanupTimer: NodeJS.Timeout | null = null;
    private autoSaveTimer: NodeJS.Timeout | null = null;

    // Packet dictionary reference (shared with server.ts)
    private packetDictionary: Map<string, string>;
    private packetDictionaryReverse: Map<string, string>;

    constructor(
        configDir: string,
        packetDictionary: Map<string, string>,
        packetDictionaryReverse: Map<string, string>,
    ) {
        this.configDir = configDir;
        this.logsSubDir = path.join(configDir, 'cache-logs');
        this.packetDictionary = packetDictionary;
        this.packetDictionaryReverse = packetDictionaryReverse;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public async init(settings?: Partial<LogRetentionSettings>) {
        if (settings) {
            this.enabled = settings.enabled ?? false;
            this.autoSaveEnabled = settings.autoSaveEnabled ?? false;
            this.retentionCount = settings.retentionCount ?? 7;
        }

        // Start cleanup timer
        this.cleanupTimer = setInterval(() => this.cleanupOldLogs(), CLEANUP_INTERVAL);

        // Setup event listeners if enabled
        if (this.enabled) {
            this.setupListeners();
        }

        // Setup auto-save if enabled
        if (this.autoSaveEnabled) {
            this.startAutoSave();
        }

        logger.info(`[LogRetention] Initialized. Enabled: ${this.enabled}, AutoSave: ${this.autoSaveEnabled}`);
    }

    public getSettings(): LogRetentionSettings {
        return {
            enabled: this.enabled,
            autoSaveEnabled: this.autoSaveEnabled,
            retentionCount: this.retentionCount,
        };
    }

    // Getters for packet history (for API endpoints)
    public getCommandPacketHistory(): Array<{ entity: string; entityId: string; command: string; value?: unknown; packet: string; timestamp: string; portId?: string }> {
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

    public getParsedPacketHistory(): Array<{ entityId: string; packet: string; state: unknown; timestamp: string; portId?: string }> {
        return this.parsedPacketLogs.map((log) => ({
            entityId: log.entityId,
            packet: this.packetDictionaryReverse.get(log.packetId) || '',
            state: log.state,
            timestamp: log.timestamp,
            portId: log.portId,
        }));
    }


    public async updateSettings(settings: Partial<LogRetentionSettings>): Promise<LogRetentionSettings> {
        const wasEnabled = this.enabled;
        const wasAutoSaveEnabled = this.autoSaveEnabled;

        if (typeof settings.enabled === 'boolean') {
            this.enabled = settings.enabled;
        }
        if (typeof settings.autoSaveEnabled === 'boolean') {
            this.autoSaveEnabled = settings.autoSaveEnabled;
        }
        if (typeof settings.retentionCount === 'number' && settings.retentionCount > 0) {
            this.retentionCount = settings.retentionCount;
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

        return this.getSettings();
    }

    public getStats(): LogRetentionStats {
        const memoryUsage = this.calculateMemoryUsage();
        const oldestTimestamp = this.getOldestLogTimestamp();

        return {
            enabled: this.enabled,
            packetLogCount: this.parsedPacketLogs.length + this.commandPacketLogs.length,
            activityLogCount: this.activityLogs.length,
            memoryUsageBytes: memoryUsage,
            oldestLogTimestamp: oldestTimestamp,
        };
    }

    private calculateMemoryUsage(): number {
        // Rough estimation of memory usage
        // Each log entry is estimated based on typical object sizes
        const packetLogSize = (this.parsedPacketLogs.length + this.commandPacketLogs.length) * 200; // ~200 bytes per entry
        const activityLogSize = this.activityLogs.length * 250; // ~250 bytes per entry

        // Dictionary overhead
        const dictSize = this.packetDictionary.size * 100; // ~100 bytes per entry

        return packetLogSize + activityLogSize + dictSize;
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

        return timestamps.length > 0 ? Math.min(...timestamps) : null;
    }

    private clearLogs(): void {
        this.parsedPacketLogs = [];
        this.commandPacketLogs = [];
        this.activityLogs = [];
    }

    private cleanupOldLogs(): void {
        if (!this.enabled) return;

        const cutoff = Date.now() - LOG_TTL;

        const originalParsedCount = this.parsedPacketLogs.length;
        this.parsedPacketLogs = this.parsedPacketLogs.filter(
            (log) => new Date(log.timestamp).getTime() >= cutoff,
        );

        const originalCommandCount = this.commandPacketLogs.length;
        this.commandPacketLogs = this.commandPacketLogs.filter(
            (log) => new Date(log.timestamp).getTime() >= cutoff,
        );

        const originalActivityCount = this.activityLogs.length;
        this.activityLogs = this.activityLogs.filter((log) => log.timestamp >= cutoff);

        const removed =
            originalParsedCount - this.parsedPacketLogs.length +
            originalCommandCount - this.commandPacketLogs.length +
            originalActivityCount - this.activityLogs.length;

        if (removed > 0) {
            logger.debug(`[LogRetention] Cleaned up ${removed} old log entries`);
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

        // Get or create packet ID (use existing dictionary from server.ts)
        let packetId = this.packetDictionary.get(pkt.packet);
        if (!packetId) {
            packetId = `p${this.packetDictionary.size + 1}`;
            this.packetDictionary.set(pkt.packet, packetId);
            this.packetDictionaryReverse.set(packetId, pkt.packet);
        }

        this.parsedPacketLogs.push({
            packetId,
            entityId: pkt.entityId || '',
            state: pkt.state,
            timestamp: pkt.timestamp || new Date().toISOString(),
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

        // Get or create packet ID
        let packetId = this.packetDictionary.get(pkt.packet);
        if (!packetId) {
            packetId = `p${this.packetDictionary.size + 1}`;
            this.packetDictionary.set(pkt.packet, packetId);
            this.packetDictionaryReverse.set(packetId, pkt.packet);
        }

        this.commandPacketLogs.push({
            packetId,
            entity: pkt.entity || '',
            entityId: pkt.entityId || '',
            command: pkt.command || '',
            value: pkt.value,
            timestamp: pkt.timestamp || new Date().toISOString(),
            portId: pkt.portId,
        });
    };

    private handleActivityLog = (data: unknown) => {
        if (!this.enabled) return;

        const log = data as ActivityLogEntry;
        this.activityLogs.push(log);
    };

    private setupListeners() {
        eventBus.on('parsed-packet', this.handleParsedPacket);
        eventBus.on('command-packet', this.handleCommandPacket);
        eventBus.on('activity-log:added', this.handleActivityLog);
    }

    private removeListeners() {
        eventBus.off('parsed-packet', this.handleParsedPacket);
        eventBus.off('command-packet', this.handleCommandPacket);
        eventBus.off('activity-log:added', this.handleActivityLog);
    }

    // Auto-save functionality
    private startAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        this.autoSaveTimer = setInterval(() => this.autoSave(), AUTO_SAVE_INTERVAL);
        logger.info('[LogRetention] Auto-save started (24h interval)');
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

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `cache_log_${timestamp}.json`;
        const filePath = path.join(this.logsSubDir, filename);

        // Build packet dictionary for export
        const dict: Record<string, string> = {};
        this.packetDictionaryReverse.forEach((payload, id) => {
            dict[id] = payload;
        });

        const data = {
            exportedAt: new Date().toISOString(),
            stats: this.getStats(),
            packetDictionary: dict,
            parsedPacketLogs: this.parsedPacketLogs,
            commandPacketLogs: this.commandPacketLogs,
            activityLogs: this.activityLogs,
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
                for (const file of toDelete) {
                    const filePath = path.join(this.logsSubDir, file.filename);
                    await fsp.unlink(filePath);
                    logger.info(`[LogRetention] Deleted old cache log: ${file.filename}`);
                }
            }
        } catch (error) {
            logger.error({ err: error }, '[LogRetention] Failed to cleanup old files');
        }
    }

    public async listSavedFiles(): Promise<SavedLogFile[]> {
        try {
            await fsp.mkdir(this.logsSubDir, { recursive: true });
            const entries = await fsp.readdir(this.logsSubDir, { withFileTypes: true });

            const files: SavedLogFile[] = [];
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.json')) {
                    const filePath = path.join(this.logsSubDir, entry.name);
                    const stat = await fsp.stat(filePath);
                    files.push({
                        filename: entry.name,
                        size: stat.size,
                        createdAt: stat.birthtime.toISOString(),
                    });
                }
            }

            // Sort by creation date (newest first)
            files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            return files;
        } catch (error) {
            logger.error({ err: error }, '[LogRetention] Failed to list saved files');
            return [];
        }
    }

    public getFilePath(filename: string): string {
        return path.join(this.logsSubDir, filename);
    }

    public async deleteFile(filename: string): Promise<boolean> {
        try {
            const filePath = this.getFilePath(filename);
            await fsp.unlink(filePath);
            return true;
        } catch {
            return false;
        }
    }

    public destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.stopAutoSave();
        this.removeListeners();
    }
}
