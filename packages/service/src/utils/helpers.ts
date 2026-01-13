/**
 * Shared helper functions for the service package
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@rs485-homenet/core';
import { CONFIG_RESTART_FLAG, BASE_MQTT_PREFIX } from './constants.js';
import type { FrontendSettings, RawPacketPayload, RawPacketEvent } from '../types/index.js';

// --- MQTT Helpers ---

/**
 * Splits a topic string into normalized parts, filtering out empty segments.
 */
export const normalizeTopicParts = (topic: string): string[] => topic.split('/').filter(Boolean);

/**
 * Pre-computed base prefix parts for topic parsing.
 */
export const BASE_PREFIX_PARTS = normalizeTopicParts(BASE_MQTT_PREFIX);

/**
 * Masks the password in an MQTT URL for safe logging/display.
 */
export function maskMqttPassword(url: string | undefined): string {
  if (!url) return '';
  try {
    if (!url.includes('://')) return url;
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '******';
      return parsed.toString();
    }
    return url;
  } catch (e) {
    // Robust fallback for invalid URLs (e.g. typos, spaces)
    // Matches: ://[user]:[password]@[host]
    // Group 1: ://user: (or ://:) - finds first colon after scheme
    // Group 2: password (greedy match until last @)
    // Group 3: @
    return url.replace(/(:\/\/[^:]*:)(.+)(@)/, '$1******$3');
  }
}

// --- File System Helpers ---

/**
 * Checks if a file or directory exists at the given path.
 */
export const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return false;
    throw error;
  }
};

/**
 * Securely resolves a file path against a base directory, preventing path traversal.
 * Returns null if the resolved path is outside the base directory.
 */
export const resolveSecurePath = (baseDir: string, filename: string): string | null => {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, filename);

  if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
    return null;
  }

  return resolvedPath;
};

// --- Environment Variable Helpers ---

/**
 * Parses a comma-separated list from environment variables.
 * Supports migration from legacy key to primary key.
 */
export const parseEnvList = (
  primaryKey: string,
  legacyKey: string,
  label: string,
): { source: string | null; values: string[] } => {
  const raw = process.env[primaryKey] ?? process.env[legacyKey];
  const source = process.env[primaryKey] ? primaryKey : process.env[legacyKey] ? legacyKey : null;

  if (!raw) return { source, values: [] };

  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    throw new Error(`[service] ${source}에 최소 1개 이상의 ${label}을 지정하세요.`);
  }

  if (!raw.includes(',')) {
    logger.warn(
      `[service] ${source}에 단일 값이 입력되었습니다. 쉼표로 구분된 배열 형식(${source}=item1,item2)` +
        ' 사용을 권장합니다.',
    );
  }

  if (source === legacyKey && primaryKey !== legacyKey) {
    logger.warn(`[service] ${legacyKey} 대신 ${primaryKey} 환경 변수를 사용하도록 전환해주세요.`);
  }

  return { source, values };
};

// --- System Helpers ---

/**
 * Creates a restart flag file to signal that a restart is required.
 * Used by HA addon run.sh or manual container restart in dev.
 */
export const triggerRestart = async (): Promise<void> => {
  await fs.writeFile(CONFIG_RESTART_FLAG, new Date().toISOString(), 'utf-8');
  logger.info('[service] Restart required. Please restart the addon/container to apply changes.');
};

// --- Frontend Settings Helpers ---

const DEFAULT_FRONTEND_SETTINGS: FrontendSettings = {
  toast: {
    stateChange: false,
    command: true,
  },
  activityLog: {
    hideAutomationScripts: true,
  },
  locale: 'ko',
  logRetention: {
    enabled: true,
    autoSaveEnabled: false,
    retentionCount: 7,
    ttlHours: 1,
  },
};

/**
 * Normalizes partial frontend settings to ensure all required fields have defaults.
 */
export const normalizeFrontendSettings = (
  value: Partial<FrontendSettings> | null | undefined,
): FrontendSettings => {
  return {
    toast: {
      stateChange:
        typeof value?.toast?.stateChange === 'boolean'
          ? value.toast.stateChange
          : DEFAULT_FRONTEND_SETTINGS.toast.stateChange,
      command:
        typeof value?.toast?.command === 'boolean'
          ? value.toast.command
          : DEFAULT_FRONTEND_SETTINGS.toast.command,
    },
    activityLog: {
      hideAutomationScripts:
        typeof value?.activityLog?.hideAutomationScripts === 'boolean'
          ? value.activityLog.hideAutomationScripts
          : DEFAULT_FRONTEND_SETTINGS.activityLog!.hideAutomationScripts,
    },
    locale: undefined, // Will be set below if valid
    logRetention: {
      enabled:
        typeof value?.logRetention?.enabled === 'boolean'
          ? value.logRetention.enabled
          : DEFAULT_FRONTEND_SETTINGS.logRetention!.enabled,
      autoSaveEnabled:
        typeof value?.logRetention?.autoSaveEnabled === 'boolean'
          ? value.logRetention.autoSaveEnabled
          : DEFAULT_FRONTEND_SETTINGS.logRetention!.autoSaveEnabled,
      retentionCount:
        typeof value?.logRetention?.retentionCount === 'number' &&
        value.logRetention.retentionCount > 0
          ? value.logRetention.retentionCount
          : DEFAULT_FRONTEND_SETTINGS.logRetention!.retentionCount,
      ttlHours:
        typeof value?.logRetention?.ttlHours === 'number' && value.logRetention.ttlHours > 0
          ? value.logRetention.ttlHours
          : DEFAULT_FRONTEND_SETTINGS.logRetention!.ttlHours,
    },
  };
};

/**
 * Creates a normalized raw packet event with defaults.
 */
export const normalizeRawPacket = (
  data: RawPacketPayload & { direction?: 'RX' | 'TX' },
): RawPacketEvent => {
  const portId = data.portId ?? 'raw';
  const topic = data.topic ?? `${BASE_MQTT_PREFIX}/${portId}/raw`;

  return {
    topic,
    payload: typeof data.payload === 'string' ? data.payload : '',
    receivedAt: data.receivedAt ?? new Date().toISOString(),
    interval: typeof data.interval === 'number' ? data.interval : null,
    portId,
    direction: data.direction ?? 'RX',
  };
};

// --- Topic Parsing Helpers ---

/**
 * Extracts entity ID from a topic path.
 */
export const extractEntityIdFromTopic = (topic: string): string => {
  const parts = normalizeTopicParts(topic);
  if (parts.length >= 3) {
    return parts[parts.length - 2];
  }
  return parts.at(-1) ?? topic;
};

/**
 * Checks if a topic is a state topic (ends with /state).
 */
export const isStateTopic = (topic: string): boolean => {
  const parts = normalizeTopicParts(topic);
  return parts.length >= 3 && parts[parts.length - 1] === 'state';
};

/**
 * Parses the default frontend settings constant.
 */
export const getDefaultFrontendSettings = (): FrontendSettings => DEFAULT_FRONTEND_SETTINGS;

// --- Date/Time Helpers ---

/**
 * Returns a timestamp string in the local timezone (respecting system TZ).
 * Format: YYYY-MM-DDTHH:mm:ss.SSS+HH:mm (ISO 8601 like, but with local offset)
 */
export const getLocalTimestamp = (dateInput?: Date | string | number): string => {
  const date = dateInput ? new Date(dateInput) : new Date();

  // Get offset in minutes (e.g., -540 for Asia/Seoul KST +09:00)
  // getTimezoneOffset() returns positive for West, negative for East.
  // We need positive for East, negative for West for the ISO string.
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMinsRemainder = Math.abs(offsetMinutes) % 60;

  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetString = `${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinsRemainder).padStart(2, '0')}`;

  const pad = (n: number) => String(n).padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${offsetString}`;
};
