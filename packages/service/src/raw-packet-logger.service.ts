import { eventBus } from '@rs485-homenet/core';
import { logger } from '@rs485-homenet/core';
import fs from 'node:fs';
import path from 'node:path';

interface LogOptions {
    configDir: string;
}

export class RawPacketLoggerService {
    private isLogging = false;
    private currentLogFile: string | null = null;
    private writeStream: fs.WriteStream | null = null;
    private configDir: string;

    constructor(configDir: string) {
        this.configDir = configDir;
    }

    public start(meta?: any) {
        if (this.isLogging) return;

        try {
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
                    `Config Files: ${Array.isArray(meta.configFiles) ? meta.configFiles.join(', ') : 'N/A'}`,
                    'Serials:',
                    ...(Array.isArray(meta.serials)
                        ? meta.serials.map((s: any) => ` - ${s.portId}: ${s.path} (Baud: ${s.baudRate || 'N/A'})`)
                        : [' - N/A']),
                    'Packet Stats:',
                    ...(meta.stats
                        ? Object.entries(meta.stats).map(([portId, s]: [string, any]) =>
                            ` - ${portId}: Packet(Avg=${s.packetAvg}ms, Std=${s.packetStdDev}ms), Idle(Avg=${s.idleAvg}ms, Std=${s.idleStdDev}ms), Samples=${s.sampleSize}`)
                        : [' - Stats not available']),
                    '==================================================',
                    '', // Empty line
                ].join('\n');
                this.writeStream.write(header);
            }

            this.isLogging = true;
            logger.info(`[RawPacketLogger] Started logging to ${filename}`);

            this.setupListeners();
        } catch (error) {
            logger.error({ err: error, configDir: this.configDir }, '[RawPacketLogger] Failed to start logging');
            this.stop(); // Cleanup if partial failure
            throw error; // Re-throw to let API know it failed
        }
    }

    public stop(): { filename: string; path: string } | null {
        if (!this.isLogging || !this.currentLogFile) return null;

        if (this.writeStream) {
            this.writeStream.end();
            this.writeStream = null;
        }

        this.removeListeners();
        this.isLogging = false;

        const result = {
            filename: path.basename(this.currentLogFile),
            path: this.currentLogFile,
        };
        this.currentLogFile = null;

        logger.info(`[RawPacketLogger] Stopped logging.`);
        return result;
    }

    public getFilePath(filename: string): string {
        return path.join(this.configDir, 'logs', filename);
    }

    private setupListeners() {
        eventBus.on('raw-data-with-interval', this.handleRxPacket);
        eventBus.on('raw-tx-packet', this.handleTxPacket);
    }

    private removeListeners() {
        eventBus.off('raw-data-with-interval', this.handleRxPacket);
        eventBus.off('raw-tx-packet', this.handleTxPacket);
    }

    private handleRxPacket = (data: any) => {
        if (!this.writeStream) return;
        const { portId, payload, receivedAt } = data;
        const logLine = `[${receivedAt}] [${portId}] [RX] ${payload}\n`;
        this.writeStream.write(logLine);
    };

    private handleTxPacket = (data: any) => {
        if (!this.writeStream) return;
        const { portId, payload, timestamp } = data;
        const logLine = `[${timestamp}] [${portId}] [TX] ${payload}\n`;
        this.writeStream.write(logLine);
    };
}
