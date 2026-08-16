import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import { logger } from '@rs485-homenet/core';
import {
  triggerRestart,
  normalizeTopicParts,
  BASE_PREFIX_PARTS,
  maskMqttPassword,
  fileExists,
  resolveSecurePath,
  parseEnvList,
  normalizeFrontendSettings,
  getGalleryRawBaseUrl,
  getGalleryListUrl,
  normalizeRawPacket,
  extractEntityIdFromTopic,
  isStateTopic,
  getDefaultFrontendSettings,
  getLocalTimestamp,
  isDefaultGallerySettings,
  discoverConfigFiles,
} from '../../src/utils/helpers.js';
import { CONFIG_RESTART_FLAG, BASE_MQTT_PREFIX } from '../../src/utils/constants.js';

// Mock dependencies
vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
  },
}));

vi.mock('@rs485-homenet/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rs485-homenet/core')>();
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

describe('helpers.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('triggerRestart', () => {
    it('should write ISO string to restart flag file and log info message', async () => {
      // Mock the Date object to have a predictable ISO string
      const fakeDate = new Date('2023-01-01T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(fakeDate);

      await triggerRestart();

      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(fs.writeFile).toHaveBeenCalledWith(
        CONFIG_RESTART_FLAG,
        fakeDate.toISOString(),
        'utf-8',
      );

      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        '[service] Restart required. Please restart the addon/container to apply changes.',
      );

      vi.useRealTimers();
    });
  });

  describe('normalizeTopicParts', () => {
    it('should split topic and remove empty parts', () => {
      expect(normalizeTopicParts('a/b/c')).toEqual(['a', 'b', 'c']);
      expect(normalizeTopicParts('/a//b/c/')).toEqual(['a', 'b', 'c']);
      expect(normalizeTopicParts('')).toEqual([]);
    });
  });

  describe('maskMqttPassword', () => {
    it('should mask the password in an MQTT URL', () => {
      expect(maskMqttPassword('mqtt://user:pass@localhost:1883')).toBe(
        'mqtt://user:******@localhost:1883',
      );
    });

    it('should return empty string for falsy input', () => {
      expect(maskMqttPassword(undefined)).toBe('');
      expect(maskMqttPassword('')).toBe('');
    });

    it('should return original string if no protocol is found', () => {
      expect(maskMqttPassword('not-a-url')).toBe('not-a-url');
    });

    it('should not mask if there is no password', () => {
      expect(maskMqttPassword('mqtt://localhost:1883')).toBe('mqtt://localhost:1883');
      expect(maskMqttPassword('mqtt://user@localhost:1883')).toBe('mqtt://user@localhost:1883');
    });

    it('should still mask even if URL parsing fails but contains username and password', () => {
      expect(maskMqttPassword('mqtt://user:pass@invalid format')).toBe(
        'mqtt://user:******@invalid format',
      );
    });
  });

  describe('extractEntityIdFromTopic', () => {
    it('should extract entity ID from a valid topic path', () => {
      expect(extractEntityIdFromTopic('homenet2mqtt/light/living_room/state')).toBe('living_room');
    });

    it('should return last part if length is less than 3', () => {
      expect(extractEntityIdFromTopic('homenet2mqtt/light')).toBe('light');
    });

    it('should handle empty strings and return empty string or original', () => {
      expect(extractEntityIdFromTopic('')).toBe('');
      expect(extractEntityIdFromTopic('/')).toBe('/');
    });
  });

  describe('isStateTopic', () => {
    it('should return true if topic ends with state and has at least 3 parts', () => {
      expect(isStateTopic('homenet2mqtt/light/living_room/state')).toBe(true);
    });

    it('should return false if topic does not end with state', () => {
      expect(isStateTopic('homenet2mqtt/light/living_room/command')).toBe(false);
    });

    it('should return false if topic is too short', () => {
      expect(isStateTopic('light/state')).toBe(false);
      expect(isStateTopic('state')).toBe(false);
    });
  });

  describe('getLocalTimestamp', () => {
    it('should format date to ISO 8601 like string with local offset', () => {
      const date = new Date('2023-01-01T12:00:00.000Z');
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

      const expectedStr = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}${offsetString}`;

      expect(getLocalTimestamp(date)).toBe(expectedStr);
    });
  });

  describe('parseEnvList', () => {
    it('should parse environment variables list from primary or legacy key', () => {
      process.env.PRIMARY_KEY = 'val1, val2, val3';
      const result = parseEnvList('PRIMARY_KEY', 'LEGACY_KEY', 'values');
      expect(result).toEqual({ source: 'PRIMARY_KEY', values: ['val1', 'val2', 'val3'] });
      delete process.env.PRIMARY_KEY;
    });

    it('should fallback to legacy key and log a warning', () => {
      process.env.LEGACY_KEY = 'val1, val2';
      const result = parseEnvList('PRIMARY_KEY', 'LEGACY_KEY', 'values');
      expect(result).toEqual({ source: 'LEGACY_KEY', values: ['val1', 'val2'] });
      expect(logger.warn).toHaveBeenCalledWith(
        '[service] LEGACY_KEY 대신 PRIMARY_KEY 환경 변수를 사용하도록 전환해주세요.',
      );
      delete process.env.LEGACY_KEY;
    });

    it('should return empty list if no values are provided', () => {
      const result = parseEnvList('PRIMARY_KEY', 'LEGACY_KEY', 'values');
      expect(result).toEqual({ source: null, values: [] });
    });

    it('should throw error if env var contains only empty values', () => {
      process.env.PRIMARY_KEY = ' , ,  ';
      expect(() => parseEnvList('PRIMARY_KEY', 'LEGACY_KEY', 'values')).toThrow(
        '[service] PRIMARY_KEY에 최소 1개 이상의 values을 지정하세요.',
      );
      delete process.env.PRIMARY_KEY;
    });
  });

  describe('normalizeFrontendSettings', () => {
    it('should normalize partial frontend settings to full settings', () => {
      const input = { locale: 'en' };
      const normalized = normalizeFrontendSettings(input as any);
      const defaults = getDefaultFrontendSettings();
      expect(normalized.toast.stateChange).toBe(defaults.toast.stateChange);
      expect(normalized.toast.command).toBe(defaults.toast.command);
      expect(normalized.activityLog.hideAutomationScripts).toBe(
        defaults.activityLog!.hideAutomationScripts,
      );
      // locale gets normalized as undefined by default behavior
      expect(normalized.locale).toBeUndefined();
    });

    it('should override default settings if provided', () => {
      const input = { toast: { stateChange: true, command: false } };
      const normalized = normalizeFrontendSettings(input);
      expect(normalized.toast.stateChange).toBe(true);
      expect(normalized.toast.command).toBe(false);
    });
  });

  describe('getGalleryRawBaseUrl', () => {
    it('should get default gallery raw base URL', () => {
      expect(getGalleryRawBaseUrl()).toBe(
        'https://raw.githubusercontent.com/wooooooooooook/homenet2mqtt/main/gallery',
      );
    });

    it('should get gallery raw base URL with custom settings', () => {
      const settings = {
        githubUrl: 'https://github.com/user/repo',
        branch: 'dev',
        path: 'my-gallery',
      };
      expect(getGalleryRawBaseUrl(settings)).toBe(
        'https://raw.githubusercontent.com/user/repo/dev/my-gallery',
      );
    });

    it('should handle trailing slashes in URLs properly', () => {
      const settings = {
        githubUrl: 'https://github.com/user/repo/',
        branch: 'main',
        path: 'gallery',
      };
      expect(getGalleryRawBaseUrl(settings)).toBe(
        'https://raw.githubusercontent.com/user/repo/main/gallery',
      );
    });
  });

  describe('getGalleryListUrl', () => {
    it('should return correct list URL', () => {
      expect(getGalleryListUrl()).toBe(
        'https://raw.githubusercontent.com/wooooooooooook/homenet2mqtt/main/gallery/list_new.json',
      );
    });
  });

  describe('normalizeRawPacket', () => {
    it('should normalize raw packet data', () => {
      const payload = {
        payload: 'hello',
        receivedAt: '2023-01-01T00:00:00Z',
        direction: 'TX' as const,
      };
      const normalized = normalizeRawPacket(payload);
      expect(normalized.topic).toBe(`${BASE_MQTT_PREFIX}/raw/raw`);
      expect(normalized.payload).toBe('hello');
      expect(normalized.receivedAt).toBe('2023-01-01T00:00:00Z');
      expect(normalized.interval).toBeNull();
      expect(normalized.portId).toBe('raw');
      expect(normalized.direction).toBe('TX');
    });
  });

  describe('isDefaultGallerySettings', () => {
    it('should return true for undefined gallery settings', () => {
      expect(isDefaultGallerySettings()).toBe(true);
    });

    it('should return true for identical settings', () => {
      expect(
        isDefaultGallerySettings({
          githubUrl: 'https://github.com/wooooooooooook/homenet2mqtt',
          branch: 'main',
          path: 'gallery',
        }),
      ).toBe(true);
    });

    it('should return false for different settings', () => {
      expect(isDefaultGallerySettings({ branch: 'dev' })).toBe(false);
    });
  });

  describe('discoverConfigFiles', () => {
    it('should return list of config files', async () => {
      const mockEntries = [
        { isFile: () => true, name: 'default.homenet_bridge.yaml' },
        { isFile: () => true, name: 'other.yaml' },
        { isFile: () => false, name: 'dir' },
      ];

      const mockedReaddir = fs.readdir as unknown as ReturnType<typeof vi.fn>;
      mockedReaddir.mockResolvedValueOnce(mockEntries);

      const mockedReadFile = fs.readFile as unknown as ReturnType<typeof vi.fn>;
      mockedReadFile.mockImplementation((filePath) => {
        if (filePath.toString().includes('default.homenet_bridge.yaml')) {
          return Promise.resolve('homenet_bridge: \n  test: true');
        }
        if (filePath.toString().includes('other.yaml')) {
          return Promise.resolve('something_else: true');
        }
        return Promise.reject(new Error('File not found'));
      });

      const files = await discoverConfigFiles('/mock/dir');
      expect(files).toEqual(['default.homenet_bridge.yaml']);
    });

    it('should handle errors gracefully and return empty array', async () => {
      const mockedReaddir = fs.readdir as unknown as ReturnType<typeof vi.fn>;
      mockedReaddir.mockRejectedValueOnce(new Error('Failed to read dir'));

      const files = await discoverConfigFiles('/mock/dir');
      expect(files).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
