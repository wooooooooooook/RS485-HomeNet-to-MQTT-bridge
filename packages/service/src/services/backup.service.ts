/**
 * Backup management service
 * Handles backup file creation, listing, and cleanup
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '@rs485-homenet/core';
import { dumpConfigToYaml } from '../utils/yaml-dumper.js';
import { CONFIG_DIR } from '../utils/constants.js';
import { fileExists } from '../utils/helpers.js';
import type { BackupFileInfo } from '../types/index.js';

let BACKUP_DIR = path.join(CONFIG_DIR, 'backups');

/**
 * Initialize the backup directory
 */
export const initializeBackupDir = async (): Promise<void> => {
    BACKUP_DIR = path.join(CONFIG_DIR, 'backups');
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    logger.info(`[service] Using backup directory: ${BACKUP_DIR}`);
};

/**
 * Get the current backup directory path
 */
export const getBackupDir = (): string => BACKUP_DIR;

/**
 * List all backup files sorted by creation date (newest first)
 */
export const listBackupFiles = async (): Promise<BackupFileInfo[]> => {
    try {
        const entries = await fs.readdir(BACKUP_DIR);
        const files = await Promise.all(
            entries.map(async (filename) => {
                const filePath = path.join(BACKUP_DIR, filename);
                const stats = await fs.stat(filePath);
                if (!stats.isFile()) return null;
                return {
                    filename,
                    size: stats.size,
                    createdAt: stats.mtime.toISOString(),
                };
            }),
        );

        return files
            .filter((file): file is BackupFileInfo => Boolean(file))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') return [];
        throw error;
    }
};

/**
 * Resolve and validate a backup file path to prevent path traversal
 */
export const resolveBackupPath = (filename: string): string | null => {
    const resolved = path.resolve(BACKUP_DIR, filename);
    const prefix = path.resolve(BACKUP_DIR) + path.sep;
    if (!resolved.startsWith(prefix)) return null;
    return resolved;
};

/**
 * Save a backup of a configuration file
 */
export const saveBackup = async (
    configPath: string,
    config: any,
    reason: string,
): Promise<string> => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `${path.basename(configPath)}.${timestamp}.${reason}.bak`;
    const backupPath = path.join(BACKUP_DIR, backupFilename);
    const backupYaml = dumpConfigToYaml(config);
    await fs.writeFile(backupPath, backupYaml, 'utf-8');
    return backupPath;
};

/**
 * Delete a backup file by filename
 */
export const deleteBackupFile = async (filename: string): Promise<boolean> => {
    const filePath = resolveBackupPath(filename);
    if (!filePath) return false;

    if (await fileExists(filePath)) {
        await fs.unlink(filePath);
        return true;
    }
    return false;
};

/**
 * Cleanup backup files based on mode
 * @param mode 'all' to delete all, 'keep_recent' to keep N most recent
 * @param keepCount Number of recent backups to keep (only for 'keep_recent' mode)
 */
export const cleanupBackups = async (
    mode: 'all' | 'keep_recent',
    keepCount: number = 0,
): Promise<number> => {
    const files = await listBackupFiles();
    const targets = mode === 'all' ? files : files.slice(Math.max(keepCount, 0));

    await Promise.all(
        targets.map(async (file) => {
            const filePath = resolveBackupPath(file.filename);
            if (!filePath) return;
            if (await fileExists(filePath)) {
                await fs.unlink(filePath);
            }
        }),
    );

    return targets.length;
};
