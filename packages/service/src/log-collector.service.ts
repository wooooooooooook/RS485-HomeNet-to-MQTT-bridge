
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { eventBus, logger, HomeNetBridge, logBuffer } from '@rs485-homenet/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Should be imported from core/config or similar if available,
// but we can resolve the config dir relative to this file or use env.
// In the monorepo structure, we want to target packages/core/config unless overridden.
// When running the service from packages/service, process.cwd() is usually the root of the monorepo (in Docker) or packages/service (local).
// We'll rely on env or relative path resolution that works in the Docker env.
const CONFIG_DIR = process.env.CONFIG_ROOT || path.resolve(__dirname, '../../core/config');
const CONSENT_FILE = path.join(CONFIG_DIR, '.share_logs');

const LOG_COLLECTOR_URL = 'https://h2m-log-collector.nubiz.workers.dev/';
const API_KEY = 'h2m-log-collector-is-cool';

export class LogCollectorService {
  private packetBuffer: string[] = [];
  private isCollecting = false;
  private bridges: HomeNetBridge[] = [];
  private packetCount = 0;
  private consentChecked = false;
  private hasConsented = false;

  constructor() {}

  async init(bridges: HomeNetBridge[]) {
    this.bridges = bridges;
    await this.checkConsent();
    if (this.hasConsented) {
      this.startCollection();
    }
  }

  async checkConsent() {
    try {
      const content = await fs.readFile(CONSENT_FILE, 'utf-8');
      this.hasConsented = content.trim() === 'true';
    } catch {
      this.hasConsented = false;
    }
    this.consentChecked = true;
  }

  async setConsent(consent: boolean) {
    this.hasConsented = consent;
    try {
      if (consent) {
        await fs.mkdir(path.dirname(CONSENT_FILE), { recursive: true });
        await fs.writeFile(CONSENT_FILE, 'true');
        this.startCollection();
      } else {
        await fs.rm(CONSENT_FILE, { force: true });
        this.stopCollection();
      }
    } catch (err) {
      logger.error({ err }, '[LogCollector] Failed to update consent file');
    }
  }

  getConsentStatus() {
    return {
      asked: this.consentChecked, // Actually we assume if file exists it was asked?
      // User said: "First run... show message".
      // If file doesn't exist, we assume "not asked" or "not consented".
      // We can use a separate logic or just rely on file existence = consented.
      // But we need to know if we should show the modal.
      // Let's check if the file exists. If it exists, user made a choice (agreed).
      // If it doesn't exist, maybe they disagreed or never asked.
      // To distinguish "never asked" from "disagreed", we might need another flag.
      // But for now, let's assume !file -> show modal.
      // Wait, if they disagree, we don't write the file. So on next boot, we show modal again?
      // That's annoying. We should write a "false" or similar.
      // Let's change logic: file content 'true' or 'false'.
      consented: this.hasConsented,
      hasChoice: this.consentChecked, // This flag is just internal state
    };
  }

  // Improved getStatus for API
  async getPublicStatus() {
    let choiceMade = false;
    let consented = false;
    try {
      const content = await fs.readFile(CONSENT_FILE, 'utf-8');
      choiceMade = true;
      consented = content.trim() === 'true';
    } catch {
      choiceMade = false;
    }
    return { asked: choiceMade, consented };
  }

  // Update setConsent to write 'false' instead of deleting
  async updateConsent(consent: boolean) {
    this.hasConsented = consent;
    try {
        await fs.mkdir(path.dirname(CONSENT_FILE), { recursive: true });
        await fs.writeFile(CONSENT_FILE, consent ? 'true' : 'false');
        if (consent) {
            this.startCollection();
        } else {
            this.stopCollection();
        }
    } catch (err) {
        logger.error({ err }, '[LogCollector] Failed to update consent file');
    }
  }

  startCollection() {
    if (this.isCollecting) return;

    // Only collect if we haven't already finished for this session?
    // User said "Every execution".
    // So we reset on start.
    this.packetBuffer = [];
    this.packetCount = 0;
    this.isCollecting = true;

    logger.info('[LogCollector] Starting packet collection (target: 1000 packets)');

    // Enable raw listeners
    this.bridges.forEach(b => b.startRawPacketListener());

    // Subscribe
    eventBus.on('raw-data-with-interval', this.handlePacketBound);
  }

  stopCollection() {
    if (!this.isCollecting) return;
    this.isCollecting = false;
    this.bridges.forEach(b => b.stopRawPacketListener());
    eventBus.off('raw-data-with-interval', this.handlePacketBound);
  }

  private handlePacketBound = this.handlePacket.bind(this);

  private handlePacket(data: any) {
    if (!this.isCollecting) return;

    if (this.packetCount >= 1000) {
      // Should have stopped already
      return;
    }

    // data.payload is hex string
    this.packetBuffer.push(data.payload);
    this.packetCount++;

    if (this.packetCount >= 1000) {
      this.stopCollection();
      this.sendData();
    }
  }

  async sendData() {
    logger.info('[LogCollector] 1000 packets collected. Sending report...');

    try {
      const logs = logBuffer.getLogs();
      const payload = {
        architecture: process.arch,
        version: await this.getAddonVersion(),
        packets: this.packetBuffer,
        logs: logs,
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
    // Try HA Supervisor API
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
    // Fallback: try to read package.json of service?
    // Or just return 'dev'
    return process.env.npm_package_version || 'unknown';
  }
}

export const logCollectorService = new LogCollectorService();
