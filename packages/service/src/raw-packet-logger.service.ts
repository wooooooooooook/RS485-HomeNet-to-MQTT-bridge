import { eventBus } from '@rs485-homenet/core';
import { logger } from '@rs485-homenet/core';
import fs from 'node:fs';
import path from 'node:path';

interface LogOptions {
  configDir: string;
}

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

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
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
          `Log Started: ${new Date().toISOString()}`,
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
        `Log Ended: ${new Date().toISOString()}`,
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

  public getFilePath(filename: string): string {
    return path.join(this.configDir, 'logs', filename);
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
    const logLine = `[${receivedAt}] [${portId}] [RX] ${payload}\n`;
    this.writeStream.write(logLine);
  };

  private handleTxPacket = (data: any) => {
    if (!this.writeStream) return;
    this.packetCount++;
    const { portId, payload, timestamp } = data;
    const logLine = `[${timestamp}] [${portId}] [TX] ${payload}\n`;
    this.writeStream.write(logLine);
  };
}
