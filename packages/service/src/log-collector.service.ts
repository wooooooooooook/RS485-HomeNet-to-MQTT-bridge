import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { eventBus, logger, HomeNetBridge, logBuffer } from '@rs485-homenet/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = process.env.CONFIG_ROOT || path.resolve(__dirname, '../../core/config');
const LEGACY_CONSENT_FILE = path.join(CONFIG_DIR, '.share_logs');
const LOG_CONFIG_FILE = path.join(CONFIG_DIR, 'log_sharing.json');

const LOG_COLLECTOR_URL = 'https://h2m-log-collector.nubiz.workers.dev/';
const API_KEY = process.env.LOG_COLLECTOR_API_KEY || 'h2m-log-collector-is-cool';

interface LogConfig {
  consent: boolean | null;
  uid: string | null;
}

interface ConfigFileContent {
  name: string;
  content: string;
}

export class LogCollectorService {
  private packetBuffer: string[] = [];
  private isCollecting = false;
  private bridges: HomeNetBridge[] = [];
  private configFiles: ConfigFileContent[] = [];
  private packetCount = 0;
  private config: LogConfig = { consent: null, uid: null };

  constructor() {}

  async init(bridges: HomeNetBridge[], configFiles: ConfigFileContent[] = []) {
    this.bridges = bridges;
    this.configFiles = configFiles;
    await this.loadConfig();
    if (this.config.consent) {
      this.startCollection();
    }
  }

  private async loadConfig() {
    try {
      // Try loading new config file
      const content = await fs.readFile(LOG_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      this.config = {
        consent: typeof parsed.consent === 'boolean' ? parsed.consent : null,
        uid: typeof parsed.uid === 'string' ? parsed.uid : null,
      };
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        // Fallback: check legacy file
        await this.migrateLegacyConfig();
      } else {
        logger.error({ err: e }, '[LogCollector] Failed to load config');
        this.config = { consent: null, uid: null };
      }
    }
  }

  private async migrateLegacyConfig() {
    try {
      const content = await fs.readFile(LEGACY_CONSENT_FILE, 'utf-8');
      const legacyConsent = content.trim() === 'true';

      this.config = {
        consent: legacyConsent,
        uid: legacyConsent ? randomUUID() : null,
      };

      await this.saveConfig();

      // Remove legacy file after successful migration
      await fs.unlink(LEGACY_CONSENT_FILE).catch(() => {});
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        logger.error({ err: e }, '[LogCollector] Failed to migrate legacy config');
      }
      // If legacy file doesn't exist, we start fresh (consent: null)
    }
  }

  private async saveConfig() {
    try {
      await fs.mkdir(path.dirname(LOG_CONFIG_FILE), { recursive: true });
      await fs.writeFile(LOG_CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (err) {
      logger.error({ err }, '[LogCollector] Failed to save config');
    }
  }

  async getPublicStatus() {
    return {
      asked: this.config.consent !== null,
      consented: this.config.consent === true,
      uid: this.config.uid,
    };
  }

  async updateConsent(consent: boolean) {
    let newUid = this.config.uid;

    if (consent && !newUid) {
      newUid = randomUUID();
    }

    this.config = {
      consent,
      uid: newUid,
    };

    await this.saveConfig();

    if (consent) {
      this.startCollection();
    } else {
      this.stopCollection();
    }
  }

  startCollection() {
    if (this.isCollecting) return;

    this.packetBuffer = [];
    this.packetCount = 0;
    this.isCollecting = true;

    logger.info('[LogCollector] Starting packet collection (target: 1000 packets)');

    this.bridges.forEach((b) => b.startRawPacketListener());
    eventBus.on('raw-data-with-interval', this.handlePacketBound);
  }

  stopCollection() {
    if (!this.isCollecting) return;
    this.isCollecting = false;
    this.bridges.forEach((b) => b.stopRawPacketListener());
    eventBus.off('raw-data-with-interval', this.handlePacketBound);
  }

  private handlePacketBound = this.handlePacket.bind(this);

  private handlePacket(data: any) {
    if (!this.isCollecting) return;

    if (this.packetCount >= 1000) {
      return;
    }

    this.packetBuffer.push(data.payload);
    this.packetCount++;

    if (this.packetCount >= 1000) {
      this.stopCollection();
      this.sendData();
    }
  }

  async sendData() {
    logger.info('[LogCollector] 1000 packets collected. Sending report...');

    if (!this.config.uid) {
      logger.warn('[LogCollector] No UID present, skipping upload despite collection.');
      return;
    }

    const isRunningOnHASupervisor = !!process.env.SUPERVISOR_TOKEN;

    try {
      const logs = logBuffer.getLogs();
      const payload = {
        uid: this.config.uid,
        architecture: process.arch,
        version: await this.getAddonVersion(),
        isRunningOnHASupervisor,
        packets: this.packetBuffer,
        logs: logs,
        configs: this.configFiles,
        timestamp: Date.now(),
      };

      const response = await fetch(LOG_COLLECTOR_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Status ${response.status}: ${await response.text()}`);
      }

      logger.info('[LogCollector] Report sent successfully.');
    } catch (err) {
      logger.error({ err }, '[LogCollector] Failed to send report');
    }
  }

  private async getAddonVersion(): Promise<string> {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    if (supervisorToken) {
      try {
        const res = await fetch('http://supervisor/addons/self/info', {
          headers: { Authorization: `Bearer ${supervisorToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          return data.data?.version || 'unknown';
        }
      } catch (e) {
        // ignore
      }
    }
    return process.env.npm_package_version || 'unknown';
  }
}

export const logCollectorService = new LogCollectorService();
