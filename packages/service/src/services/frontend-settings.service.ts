/**
 * Frontend settings management service
 * Handles loading and saving frontend UI settings
 */

import fs from 'node:fs/promises';
import { CONFIG_DIR, FRONTEND_SETTINGS_FILE } from '../utils/constants.js';
import { normalizeFrontendSettings, getDefaultFrontendSettings } from '../utils/helpers.js';
import type { FrontendSettings } from '../types/index.js';

const DEFAULT_FRONTEND_SETTINGS = getDefaultFrontendSettings();

/**
 * Save frontend settings to disk
 */
export const saveFrontendSettings = async (settings: FrontendSettings): Promise<void> => {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(FRONTEND_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
};

/**
 * Load frontend settings from disk
 * Creates default settings file if it doesn't exist
 */
export const loadFrontendSettings = async (): Promise<FrontendSettings> => {
    try {
        const data = await fs.readFile(FRONTEND_SETTINGS_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        return normalizeFrontendSettings(parsed);
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
            await saveFrontendSettings(DEFAULT_FRONTEND_SETTINGS);
            return DEFAULT_FRONTEND_SETTINGS;
        }
        throw error;
    }
};

/**
 * Get the default frontend settings
 */
export const getDefaults = (): FrontendSettings => DEFAULT_FRONTEND_SETTINGS;
