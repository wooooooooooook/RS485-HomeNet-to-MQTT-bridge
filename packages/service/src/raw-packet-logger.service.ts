import { eventBus } from '@rs485-homenet/core';
import { logger } from '@rs485-homenet/core';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSecurePath, getLocalTimestamp } from './utils/helpers.js';

type RawPacketLogMode = 'all' | 'valid';

export class RawPacketLoggerService {
  private isLogging = false;
  private currentLogFile: string | null = null;
  private writeStream: fs.WriteStream | null = null;
  private configDir: string;
  private packetCount = 0;
  private startTime: number | null = null;
  private logMode: RawPacketLogMode = 'all';

  constructor(configDir: string) {
    this.configDir = configDir;
  }

  public start(meta?: any, options?: { mode?: RawPacketLogMode }) {
    if (this.isLogging) return;

    try {
      this.logMode = options?.mode ?? 'all';
      const logDir = path.join(this.configDir, 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const timestamp = getLocalTimestamp().replace(/[:.]/g, '-');
      const filename = `packet_log_${timestamp}.txt`;
      this.currentLogFile = path.join(logDir, filename);

      this.writeStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });

      // Handle write stream errors
      this.writeStream.on('error', (err) => {
        logger.error({ err }, '[RawPacketLogger] Write stream error');
        this.stop();
      });

      // Write Metadata Header
      if (meta) {
        const header = [
          '==================================================',
          '[METADATA]',
          `Log Started: ${getLocalTimestamp()}`,
          `Log Mode: ${this.logMode === 'valid' ? 'valid-only' : 'all'}`,
          `Config Files: ${Array.isArray(meta.configFiles) ? meta.configFiles.join(', ') : 'N/A'}`,
          'Serial:',
          meta.serial
            ? ` - ${meta.serial.portId}: ${meta.serial.path} (Baud: ${meta.serial.baudRate || 'N/A'})`
            : ' - N/A',
          'Packet Stats:',
          ...(meta.stats
            ? Object.entries(meta.stats).map(
                ([portId, s]: [string, any]) =>
                  ` - ${portId}: Packet(Avg=${s.packetAvg}ms, Std=${s.packetStdDev}ms), Idle(Avg=${s.idleAvg}ms, Std=${s.idleStdDev}ms), IdleOccur(Avg=${s.idleOccurrenceAvg}ms, Std=${s.idleOccurrenceStdDev}ms), Samples=${s.sampleSize}`,
              )
            : [' - Stats not available']),
          '==================================================',
          '', // Empty line
        ].join('\n');
        this.writeStream.write(header);
      }

      this.isLogging = true;
      this.packetCount = 0;
      this.startTime = Date.now();
      logger.info(`[RawPacketLogger] Started logging to ${filename}`);

      this.setupListeners();
    } catch (error) {
      logger.error(
        { err: error, configDir: this.configDir },
        '[RawPacketLogger] Failed to start logging',
      );
      this.stop(); // Cleanup if partial failure
      throw error; // Re-throw to let API know it failed
    }
  }

  public stop(): { filename: string; path: string } | null {
    if (!this.isLogging || !this.currentLogFile) return null;

    if (this.writeStream) {
      // Write Summary at the end
      const endTime = Date.now();
      const durationMs = this.startTime ? endTime - this.startTime : 0;
      const durationSec = Math.floor(durationMs / 1000);
      const minutes = Math.floor(durationSec / 60);
      const seconds = durationSec % 60;

      const summary = [
        '', // Empty line
        '==================================================',
        '[RECORDING SUMMARY]',
        `Log Ended: ${getLocalTimestamp()}`,
        `Total Duration: ${minutes}m ${seconds}s`,
        `Total Packets Collected: ${this.packetCount}`,
        '==================================================',
      ].join('\n');

      this.writeStream.write(summary);
      this.writeStream.end();
      this.writeStream = null;
    }

    this.removeListeners();
    this.isLogging = false;
    this.startTime = null;

    const result = {
      filename: path.basename(this.currentLogFile),
      path: this.currentLogFile,
    };
    this.currentLogFile = null;

    logger.info(`[RawPacketLogger] Stopped logging.`);
    return result;
  }

  public getStatus() {
    return {
      isLogging: this.isLogging,
      startTime: this.startTime,
      packetCount: this.packetCount,
      filename: this.currentLogFile ? path.basename(this.currentLogFile) : null,
      mode: this.isLogging ? this.logMode : null,
    };
  }

  public getFilePath(filename: string): string | null {
    return resolveSecurePath(path.join(this.configDir, 'logs'), filename);
  }

  public async listSavedFiles(): Promise<{ filename: string; size: number; createdAt: string }[]> {
    try {
      const logDir = path.join(this.configDir, 'logs');
      if (!fs.existsSync(logDir)) {
        return [];
      }

      const entries = fs.readdirSync(logDir, { withFileTypes: true });
      const files: { filename: string; size: number; createdAt: string }[] = [];

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.txt')) {
          const filePath = path.join(logDir, entry.name);
          const stat = fs.statSync(filePath);
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
      logger.error({ err: error }, '[RawPacketLogger] Failed to list saved files');
      return [];
    }
  }

  public async deleteFile(filename: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(filename);
      if (!filePath) {
        return false;
      }
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public async cleanupFiles(mode: 'all' | 'keep_recent', keepCount: number = 0): Promise<number> {
    const files = await this.listSavedFiles();
    // Files are already sorted by createdAt (newest first)
    const targets = mode === 'all' ? files : files.slice(Math.max(keepCount, 0));

    let deletedCount = 0;
    for (const file of targets) {
      const success = await this.deleteFile(file.filename);
      if (success) {
        deletedCount++;
      }
    }

    return deletedCount;
  }

  private setupListeners() {
    if (this.logMode === 'valid') {
      eventBus.on('raw-valid-packet', this.handleRxPacket);
      eventBus.on('raw-tx-packet', this.handleTxPacket);
      return;
    }
    eventBus.on('raw-data-with-interval', this.handleRxPacket);
    eventBus.on('raw-tx-packet', this.handleTxPacket);
  }

  private removeListeners() {
    eventBus.off('raw-data-with-interval', this.handleRxPacket);
    eventBus.off('raw-tx-packet', this.handleTxPacket);
    eventBus.off('raw-valid-packet', this.handleRxPacket);
  }

  private handleRxPacket = (data: any) => {
    if (!this.writeStream) return;
    this.packetCount++;
    const { portId, payload, receivedAt } = data;
    const logTimestamp = getLocalTimestamp(receivedAt);
    const logLine = `[${logTimestamp}] [${portId}] [RX] ${payload}\n`;
    this.writeStream.write(logLine);
  };

  private handleTxPacket = (data: any) => {
    if (!this.writeStream) return;
    this.packetCount++;
    const { portId, payload, timestamp } = data;
    const logTimestamp = getLocalTimestamp(timestamp);
    const logLine = `[${logTimestamp}] [${portId}] [TX] ${payload}\n`;
    this.writeStream.write(logLine);
  };
}
