/**
 * Backups Routes - handles backup management API endpoints
 */

import { Router } from 'express';
import { logger } from '@rs485-homenet/core';
import type { RateLimiter } from '../utils/rate-limiter.js';
import {
    listBackupFiles,
    resolveBackupPath,
    cleanupBackups,
    deleteBackupFile,
} from '../services/backup.service.js';

export interface BackupsRoutesContext {
    configRateLimiter: RateLimiter;
}

export function createBackupsRoutes(ctx: BackupsRoutesContext): Router {
    const router = Router();

    // List all backup files
    router.get('/api/backups', async (_req, res) => {
        try {
            const files = await listBackupFiles();
            const totalSize = files.reduce((sum, file) => sum + file.size, 0);
            res.json({ files, totalSize });
        } catch (error) {
            logger.error({ err: error }, '[service] Failed to list backup files');
            res.status(500).json({ error: 'Failed to list backup files' });
        }
    });

    // Download a backup file
    router.get('/api/backups/download/:filename', async (req, res) => {
        const { filename } = req.params;
        const filePath = resolveBackupPath(filename);

        if (!filePath) {
            return res.status(403).json({ error: 'Access denied' });
        }

        try {
            res.download(filePath);
        } catch (error) {
            logger.error({ err: error }, '[service] Backup download failed');
            res.status(500).json({ error: 'Download failed' });
        }
    });

    // Delete a backup file
    router.delete('/api/backups/:filename', async (req, res) => {
        if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
            logger.warn({ ip: req.ip }, '[service] Backup delete rate limit exceeded');
            return res.status(429).json({ error: 'Too many requests' });
        }

        const { filename } = req.params;
        const filePath = resolveBackupPath(filename);

        if (!filePath) {
            return res.status(403).json({ error: 'Access denied' });
        }

        try {
            const deleted = await deleteBackupFile(filename);
            if (deleted) {
                res.json({ success: true, message: 'Backup deleted' });
            } else {
                res.status(404).json({ error: 'File not found' });
            }
        } catch (error) {
            logger.error({ err: error }, '[service] Backup delete failed');
            res.status(500).json({ error: 'Delete failed' });
        }
    });

    // Cleanup old backups
    router.post('/api/backups/cleanup', async (req, res) => {
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
            const deletedCount = await cleanupBackups(mode, keepCount);
            res.json({ success: true, deletedCount });
        } catch (error) {
            logger.error({ err: error }, '[service] Backup cleanup failed');
            res.status(500).json({ error: 'Cleanup failed' });
        }
    });

    return router;
}

export { createBackupsRoutes as default };
