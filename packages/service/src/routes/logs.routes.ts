/**
 * Logs Routes - handles log-related API endpoints
 */

import { Router } from 'express';
import fs from 'node:fs/promises';
import { logger, HomenetBridgeConfig } from '@rs485-homenet/core';
import type { RateLimiter } from '../utils/rate-limiter.js';
import type { LogRetentionService } from '../log-retention.service.js';
import { CONFIG_INIT_MARKER } from '../utils/constants.js';
import {
  loadFrontendSettings,
  saveFrontendSettings,
} from '../services/frontend-settings.service.js';
import { fileExists } from '../utils/helpers.js';
import type { RawPacketStreamMode, BridgeInstance } from '../types/index.js';

export interface LogsRoutesContext {
  configRateLimiter: RateLimiter;
  commandRateLimiter: RateLimiter;
  rawPacketLogger: {
    getStatus: () => any;
    start: (meta: any, options: any) => Promise<void>;
    stop: () => any;
    getFilePath: (filename: string) => string | null;
    listSavedFiles: () => Promise<{ filename: string; size: number; createdAt: string }[]>;
    deleteFile: (filename: string) => Promise<boolean>;
    cleanupFiles: (mode: 'all' | 'keep_recent', keepCount?: number) => Promise<number>;
  };
  logRetentionService: LogRetentionService;
  logCollectorService: {
    getPublicStatus: () => Promise<any>;
    updateConsent: (consent: boolean) => Promise<void>;
  };
  getCurrentConfigs: () => HomenetBridgeConfig[];
  getCurrentConfigFiles: () => string[];
  getBridges: () => BridgeInstance[];
  configDir: string;
  activityLogService: {
    getRecentLogs: () => any[];
  };
}

export function createLogsRoutes(ctx: LogsRoutesContext): Router {
  const router = Router();

  // --- Log Sharing API ---
  router.get('/api/activity/recent', (_req, res) => {
    res.json(ctx.activityLogService.getRecentLogs());
  });

  router.get('/api/log-sharing/status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const status = await ctx.logCollectorService.getPublicStatus();
    res.json(status);
  });

  router.post('/api/log-sharing/consent', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { consent } = req.body;
    if (typeof consent !== 'boolean') {
      return res.status(400).json({ error: 'consent must be boolean' });
    }
    await ctx.logCollectorService.updateConsent(consent);

    // 로그 동의 완료 시 .initialized 마커 생성 (초기화 프로세스 완료)
    if (!(await fileExists(CONFIG_INIT_MARKER))) {
      await fs.writeFile(CONFIG_INIT_MARKER, new Date().toISOString(), 'utf-8');
      logger.info('[service] Initialization complete, .initialized marker created');
    }

    const status = await ctx.logCollectorService.getPublicStatus();
    res.json(status);
  });

  // --- Raw Packet Text Logging API ---
  router.get('/api/logs/packet/status', (_req, res) => {
    res.json(ctx.rawPacketLogger.getStatus());
  });

  router.post('/api/logs/packet/start', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Packet log start rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      const currentConfigs = ctx.getCurrentConfigs();
      const currentConfigFiles = ctx.getCurrentConfigFiles();
      const bridges = ctx.getBridges();

      // Gather Metadata
      const serial =
        currentConfigs
          .map((conf) => conf?.serial)
          .filter((serial): serial is NonNullable<typeof serial> => Boolean(serial))
          .map((serial) => ({
            portId: serial.portId,
            path: serial.path,
            baudRate: serial.baud_rate,
          }))[0] ?? null;

      // Prefer UI-provided stats (accumulated on client-side) over server-side stats
      let stats: Record<string, any> = {};
      const uiStats = req.body?.uiStats;
      if (uiStats && uiStats.portId) {
        stats[uiStats.portId] = uiStats;
      } else {
        // Fallback to server-side stats (may be empty if listener wasn't active)
        bridges.forEach((b) => {
          const bridgeStats = b.bridge.getPacketIntervalStats?.() || {};
          Object.assign(stats, bridgeStats);
        });
      }

      const meta = {
        configFiles: currentConfigFiles,
        serial,
        stats,
      };

      const mode: RawPacketStreamMode = req.body?.mode === 'valid' ? 'valid' : 'all';
      ctx.rawPacketLogger.start(meta, { mode });
      res.json({ success: true, message: 'Logging started' });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to start packet logging');
      res.status(500).json({ error: 'Failed to start logging' });
    }
  });

  router.post('/api/logs/packet/stop', (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Packet log stop rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      const result = ctx.rawPacketLogger.stop();
      res.json({ success: true, message: 'Logging stopped', result });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to stop packet logging');
      res.status(500).json({ error: 'Failed to stop logging' });
    }
  });

  router.get('/api/logs/packet/download/:filename', async (req, res) => {
    const { filename } = req.params;
    const filePath = ctx.rawPacketLogger.getFilePath(filename);

    if (!filePath) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        res.download(filePath);
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (error) {
      logger.error({ err: error }, '[service] Download failed');
      res.status(500).json({ error: 'Download failed' });
    }
  });

  router.delete('/api/logs/packet/:filename', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Packet log delete rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { filename } = req.params;
    const filePath = ctx.rawPacketLogger.getFilePath(filename);

    if (!filePath) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      await fs.unlink(filePath);
      res.json({ success: true, message: 'File deleted' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
      } else {
        logger.error({ err: error }, '[service] File delete failed');
        res.status(500).json({ error: 'Delete failed' });
      }
    }
  });

  // List saved packet log files
  router.get('/api/logs/packet/files', async (_req, res) => {
    try {
      const files = await ctx.rawPacketLogger.listSavedFiles();
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      res.json({ files, totalSize });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to list packet log files');
      res.status(500).json({ error: 'Failed to list files' });
    }
  });

  // Cleanup packet log files
  router.post('/api/logs/packet/cleanup', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const mode = req.body?.mode;
    const keepCountRaw = req.body?.keepCount;
    const keepCount = Number.isFinite(keepCountRaw) ? Number(keepCountRaw) : 3;

    if (!['all', 'keep_recent'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid cleanup mode' });
    }

    if (mode === 'keep_recent' && (!Number.isInteger(keepCount) || keepCount < 0)) {
      return res.status(400).json({ error: 'Invalid keep count' });
    }

    try {
      const deletedCount = await ctx.rawPacketLogger.cleanupFiles(mode, keepCount);
      res.json({ success: true, deletedCount });
    } catch (error) {
      logger.error({ err: error }, '[service] Packet log cleanup failed');
      res.status(500).json({ error: 'Cleanup failed' });
    }
  });

  // --- Log Cache API ---
  router.get('/api/logs/cache/settings', async (_req, res) => {
    try {
      const settings = ctx.logRetentionService.getSettings();
      res.json({ settings });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to get cache settings');
      res.status(500).json({ error: 'Failed to get cache settings' });
    }
  });

  router.put('/api/logs/cache/settings', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      const settings = req.body?.settings ?? req.body;
      if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ error: 'Invalid settings' });
      }

      await ctx.logRetentionService.updateSettings(settings);
      const newSettings = ctx.logRetentionService.getSettings();
      const frontendSettings = await loadFrontendSettings();
      await saveFrontendSettings({
        ...frontendSettings,
        logRetention: newSettings,
      });
      res.json({ settings: newSettings });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to update cache settings');
      res.status(500).json({ error: 'Failed to update cache settings' });
    }
  });

  router.get('/api/logs/cache/stats', (_req, res) => {
    try {
      const stats = ctx.logRetentionService.getStats();
      res.json(stats);
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to get cache stats');
      res.status(500).json({ error: 'Failed to get cache stats' });
    }
  });

  router.get('/api/logs/cache/files', async (_req, res) => {
    try {
      const files = await ctx.logRetentionService.listSavedFiles();
      res.json({ files });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to list cache files');
      res.status(500).json({ error: 'Failed to list cache files' });
    }
  });

  router.get('/api/logs/cache/download/:filename', async (req, res) => {
    const { filename } = req.params;
    const filePath = ctx.logRetentionService.getFilePath(filename);

    if (!filePath) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        res.download(filePath);
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (error) {
      logger.error({ err: error }, '[service] Cache download failed');
      res.status(500).json({ error: 'Download failed' });
    }
  });

  router.delete('/api/logs/cache/:filename', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Log cache delete rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { filename } = req.params;
    const filePath = ctx.logRetentionService.getFilePath(filename);

    if (!filePath) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const deleted = await ctx.logRetentionService.deleteFile(filename);
      if (deleted) {
        res.json({ success: true, message: 'File deleted' });
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (error) {
      logger.error({ err: error }, '[service] Cache delete failed');
      res.status(500).json({ error: 'Delete failed' });
    }
  });

  router.post('/api/logs/cache/save', async (req, res) => {
    if (!ctx.commandRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      const stats = ctx.logRetentionService.getStats();
      if (!stats.enabled) {
        return res.status(400).json({ error: 'Log caching is not enabled' });
      }

      const result = await ctx.logRetentionService.saveToFile();
      res.json({ success: true, result });
    } catch (error) {
      logger.error({ err: error }, '[service] Manual cache save failed');
      res.status(500).json({ error: 'Save failed' });
    }
  });

  // Cleanup old log cache files
  router.post('/api/logs/cache/cleanup', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const mode = req.body?.mode;
    const keepCountRaw = req.body?.keepCount;
    const keepCount = Number.isFinite(keepCountRaw) ? Number(keepCountRaw) : 3;

    if (!['all', 'keep_recent'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid cleanup mode' });
    }

    if (mode === 'keep_recent' && (!Number.isInteger(keepCount) || keepCount < 0)) {
      return res.status(400).json({ error: 'Invalid keep count' });
    }

    try {
      const deletedCount = await ctx.logRetentionService.cleanupFiles(mode, keepCount);
      res.json({ success: true, deletedCount });
    } catch (error) {
      logger.error({ err: error }, '[service] Log cache cleanup failed');
      res.status(500).json({ error: 'Cleanup failed' });
    }
  });

  return router;
}

export { createLogsRoutes as default };
