/**
 * Shared constants for the service package
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HomenetBridgeConfig } from '@rs485-homenet/core';

// --- Path Resolution ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves CONFIG_ROOT environment variable.
 * Relative paths are resolved from process.cwd().
 */
export const resolveConfigRoot = (): string => {
    const configRoot = process.env.CONFIG_ROOT;
    if (!configRoot) {
        // Default: packages/core/config (relative to utils/ -> src/ -> service/ -> core/)
        return path.resolve(__dirname, '../../../core/config');
    }
    return path.isAbsolute(configRoot) ? configRoot : path.resolve(process.cwd(), configRoot);
};

// --- Directory Constants ---

export const CONFIG_DIR = resolveConfigRoot();
export const FRONTEND_SETTINGS_FILE = path.join(CONFIG_DIR, 'frontend-setting.json');
export const DEFAULT_CONFIG_FILENAME = 'default.homenet_bridge.yaml';
export const CONFIG_INIT_MARKER = path.join(CONFIG_DIR, '.initialized');
export const CONFIG_RESTART_FLAG = path.join(CONFIG_DIR, '.restart-required');

// --- External URLs ---

export const GALLERY_RAW_BASE_URL =
    'https://raw.githubusercontent.com/wooooooooooook/RS485-HomeNet-to-MQTT-bridge/main/gallery';
export const GALLERY_LIST_URL = `${GALLERY_RAW_BASE_URL}/list.json`;

// --- Entity Type Keys ---

export const ENTITY_TYPE_KEYS: (keyof HomenetBridgeConfig)[] = [
    'light',
    'climate',
    'valve',
    'button',
    'sensor',
    'fan',
    'switch',
    'lock',
    'number',
    'select',
    'text_sensor',
    'text',
    'binary_sensor',
];

// --- Locale Constants ---

export const SUPPORTED_LOCALES = ['en', 'ko'];

// --- MQTT Constants ---

export const BASE_MQTT_PREFIX = (process.env.MQTT_TOPIC_PREFIX || 'homenet2mqtt').toString().trim();
