/**
 * Gallery Routes - handles gallery snippet API endpoints
 */

import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { HomenetBridgeConfig, logger, normalizeConfig, normalizePortId } from '@rs485-homenet/core';
import { dumpConfigToYaml } from '../utils/yaml-dumper.js';
import { expandGalleryTemplate, type GallerySnippet } from '../utils/gallery-template.js';
import {
  findAllSignatureMatches,
  type SignatureMatchCandidate,
} from '../utils/gallery-matching.js';
import {
  validateGalleryAutomationIds,
  validateGalleryEntityIds,
  validateGalleryScriptIds,
} from '../utils/gallery-validation.js';
import { getAppVersion, checkMinVersion } from '../utils/version-utils.js';
import {
  CONFIG_DIR,
  GALLERY_RAW_BASE_URL,
  GALLERY_LIST_URL,
  GALLERY_STATS_URL,
  ENTITY_TYPE_KEYS,
  IS_DEV,
  LOCAL_GALLERY_DIR,
} from '../utils/constants.js';
import { saveBackup } from '../services/backup.service.js';
import {
  evaluateDiscovery,
  type DiscoverySchema,
  type DiscoveryResult,
} from '../services/discovery.service.js';
import type { LogRetentionService } from '../log-retention.service.js';
import type { RateLimiter } from '../utils/rate-limiter.js';
import type { PersistableHomenetBridgeConfig } from '../types/index.js';

export interface GalleryRoutesContext {
  configRateLimiter: RateLimiter;
  getCurrentConfigs: () => HomenetBridgeConfig[];
  getCurrentConfigFiles: () => string[];
  getCurrentRawConfigs: () => HomenetBridgeConfig[];
  setCurrentConfigs: (index: number, config: HomenetBridgeConfig) => void;
  setCurrentRawConfigs: (index: number, config: HomenetBridgeConfig) => void;
  rebuildPortMappings: () => void;
  logRetentionService: LogRetentionService;
}

export function createGalleryRoutes(ctx: GalleryRoutesContext): Router {
  const router = Router();

  // Gallery snippet download stats API key (shared with log collector)
  const STATS_API_KEY = process.env.LOG_COLLECTOR_API_KEY;

  // Get gallery snippet download stats
  router.get('/api/gallery/stats', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      const response = await fetch(GALLERY_STATS_URL);
      if (!response.ok) {
        logger.warn(
          { status: response.status },
          '[gallery] Failed to fetch gallery stats from worker',
        );
        return res.status(response.status).json({ error: 'Stats not available' });
      }

      const statsData = await response.json();
      res.json(statsData);
    } catch (error) {
      logger.error({ err: error }, '[gallery] Failed to load gallery stats');
      res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  // Get gallery list from GitHub
  router.get('/api/gallery/list', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      if (IS_DEV) {
        const listPath = path.join(LOCAL_GALLERY_DIR, 'list_new.json');
        try {
          const listContent = await fs.readFile(listPath, 'utf8');
          return res.type('application/json').send(listContent);
        } catch (error) {
          logger.warn(
            { err: error, path: listPath },
            '[gallery] Failed to read local gallery list',
          );
          // Fallback to GitHub if local file fails
        }
      }

      const response = await fetch(GALLERY_LIST_URL);
      if (!response.ok) {
        logger.warn(
          { status: response.status },
          '[gallery] Failed to fetch gallery list from GitHub',
        );
        return res.status(response.status).json({ error: 'Gallery list not found' });
      }

      const listContent = await response.text();
      res.type('application/json').send(listContent);
    } catch (error) {
      logger.error({ err: error }, '[gallery] Failed to load gallery list from GitHub');
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Failed to load gallery list' });
    }
  });

  // Get gallery file content from GitHub
  router.get('/api/gallery/file', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      const filePath = req.query.path;
      if (typeof filePath !== 'string' || filePath.length === 0) {
        return res.status(400).json({ error: 'path query parameter is required' });
      }

      // Security: only allow paths within gallery directory (no .. traversal)
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.includes('..') || normalizedPath.startsWith('/')) {
        return res.status(400).json({ error: 'Invalid gallery path' });
      }

      const isYaml = normalizedPath.endsWith('.yaml') || normalizedPath.endsWith('.yml');
      if (!isYaml) {
        return res.status(400).json({ error: 'Only YAML gallery files are supported' });
      }

      if (IS_DEV) {
        const localFilePath = path.join(LOCAL_GALLERY_DIR, normalizedPath);
        try {
          const fileContent = await fs.readFile(localFilePath, 'utf8');
          return res.type('text/yaml').send(fileContent);
        } catch (error) {
          logger.warn(
            { err: error, path: localFilePath },
            '[gallery] Failed to read local gallery file',
          );
          // Fallback to GitHub if local file fails
        }
      }

      const fileUrl = `${GALLERY_RAW_BASE_URL}/${normalizedPath}`;
      const response = await fetch(fileUrl);
      if (!response.ok) {
        logger.warn(
          { status: response.status, path: normalizedPath },
          '[gallery] Failed to fetch gallery file from GitHub',
        );
        return res.status(response.status).json({ error: 'Gallery file not found' });
      }

      const fileContent = await response.text();
      res.type('text/yaml').send(fileContent);
    } catch (error) {
      logger.error({ err: error }, '[gallery] Failed to load gallery file from GitHub');
      res
        .status(500)
        .json({ error: error instanceof Error ? error.message : 'Failed to load gallery file' });
    }
  });

  router.post('/api/gallery/compatibility', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { portId, vendors } = req.body as {
      portId?: string;
      vendors?: Array<{
        id: string;
        requirements?: {
          serial?: Record<string, unknown>;
          packet_defaults?: Record<string, unknown>;
        };
      }>;
    };

    if (typeof portId !== 'string' || !Array.isArray(vendors)) {
      return res.status(400).json({ error: 'portId and vendors are required' });
    }

    const currentConfigs = ctx.getCurrentConfigs();
    const configForPort =
      currentConfigs.find((config, index) => {
        if (!config.serial) return false;
        return normalizePortId(config.serial.portId, index) === portId;
      }) ?? null;

    const compatibilityByVendorId: Record<string, boolean> = {};

    for (const vendor of vendors) {
      if (!vendor?.id) continue;
      if (!configForPort) {
        compatibilityByVendorId[vendor.id] = false;
        continue;
      }
      if (!vendor.requirements) {
        compatibilityByVendorId[vendor.id] = true;
        continue;
      }
      compatibilityByVendorId[vendor.id] = checkConfigRequirements(
        configForPort,
        vendor.requirements,
      );
    }

    return res.json({ compatibilityByVendorId });
  });

  // Helper to check if a config matches vendor requirements
  function checkConfigRequirements(
    config: HomenetBridgeConfig,
    requirements: { serial?: Record<string, unknown>; packet_defaults?: Record<string, unknown> },
  ): boolean {
    if (!config.serial) return false;

    // Check serial settings
    if (requirements.serial) {
      const serialFields = ['baud_rate', 'data_bits', 'parity', 'stop_bits'];
      for (const field of serialFields) {
        const expected = requirements.serial[field];
        const actual = config.serial[field as keyof typeof config.serial];
        if (expected !== undefined && actual !== undefined && expected !== actual) {
          return false;
        }
      }
    }

    // Check packet_defaults
    if (requirements.packet_defaults) {
      const packetDefaults = config.packet_defaults || {};
      const packetFields = [
        'rx_length',
        'rx_checksum',
        'tx_checksum',
        'rx_header',
        'tx_header',
        'rx_footer',
        'tx_footer',
      ];

      for (const field of packetFields) {
        const expected = requirements.packet_defaults[field];
        const actual = packetDefaults[field as keyof typeof packetDefaults];

        if (expected !== undefined) {
          // Normalize values: treat empty arrays, null, and undefined as equivalent (empty/default)
          const normalizeValue = (v: unknown): string | unknown => {
            if (v === null || v === undefined) return '__EMPTY__';
            if (Array.isArray(v) && v.length === 0) return '__EMPTY__';
            if (Array.isArray(v)) return JSON.stringify(v);
            return v;
          };

          if (normalizeValue(expected) !== normalizeValue(actual)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  // Evaluate discovery schemas against packet dictionary
  router.get('/api/gallery/discovery', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      // Check if log retention is enabled
      if (!ctx.logRetentionService.isEnabled()) {
        return res.json({
          available: false,
          results: {},
          message: 'Log retention is not enabled',
        });
      }

      const currentConfigs = ctx.getCurrentConfigs();
      const portId = typeof req.query.portId === 'string' ? req.query.portId : undefined;
      const configForPort =
        portId !== undefined
          ? (currentConfigs.find((config, index) => {
              if (!config.serial) return false;
              return normalizePortId(config.serial.portId, index) === portId;
            }) ?? null)
          : null;

      // Get packet dictionary and unmatched packets (filtered by portId if provided)
      const packetDictionary = ctx.logRetentionService.getPacketDictionary(portId);
      const unmatchedPackets = ctx.logRetentionService.getUnmatchedPackets(portId);

      // Fetch gallery list (list_new.json includes discovery info)
      let galleryList: {
        vendors: Array<{
          id: string;
          requirements?: any;
          items: Array<{
            file: string;
            discovery?: DiscoverySchema;
          }>;
        }>;
      };

      if (IS_DEV) {
        const listPath = path.join(LOCAL_GALLERY_DIR, 'list_new.json');
        try {
          const listContent = await fs.readFile(listPath, 'utf8');
          galleryList = JSON.parse(listContent);
        } catch (error) {
          logger.warn(
            { err: error, path: listPath },
            '[gallery] Failed to read local gallery list',
          );
          // Fallback to GitHub
          const listResponse = await fetch(GALLERY_LIST_URL);
          if (!listResponse.ok) {
            return res.status(listResponse.status).json({ error: 'Failed to fetch gallery list' });
          }
          galleryList = await listResponse.json();
        }
      } else {
        const listResponse = await fetch(GALLERY_LIST_URL);
        if (!listResponse.ok) {
          return res.status(listResponse.status).json({ error: 'Failed to fetch gallery list' });
        }
        galleryList = await listResponse.json();
      }

      const results: Record<string, DiscoveryResult> = {};

      // Process each vendor and item
      for (const vendor of galleryList.vendors) {
        // If vendor has requirements, check if ANY active config matches them
        if (vendor.requirements) {
          const isCompatible = portId
            ? configForPort
              ? checkConfigRequirements(configForPort, vendor.requirements)
              : false
            : currentConfigs.some((config) => checkConfigRequirements(config, vendor.requirements));

          if (!isCompatible) {
            continue; // Skip this vendor if no active config matches requirements
          }
        }

        for (const item of vendor.items) {
          // Check if item has discovery schema (included in list_new.json)
          if (item.discovery) {
            let defaultOffset = 0;
            // Check vendor requirements for rx_header length
            if (
              vendor.requirements?.packet_defaults?.rx_header &&
              Array.isArray(vendor.requirements.packet_defaults.rx_header)
            ) {
              defaultOffset = vendor.requirements.packet_defaults.rx_header.length;
            }

            const result = evaluateDiscovery(
              item.discovery,
              packetDictionary,
              unmatchedPackets,
              defaultOffset,
            );
            results[item.file] = result;
          }
        }
      }

      res.json({
        available: true,
        results,
        packetCount: Object.keys(packetDictionary).length + unmatchedPackets.length,
      });
    } catch (error) {
      logger.error({ err: error }, '[gallery] Failed to evaluate discovery');
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Discovery evaluation failed',
      });
    }
  });

  // Check for conflicts before applying gallery snippet
  router.post('/api/gallery/check-conflicts', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      const { portId, yamlContent, parameterValues } = req.body as {
        portId?: string;
        yamlContent?: string;
        parameterValues?: Record<string, unknown>;
      };

      if (!portId || !yamlContent) {
        return res.status(400).json({ error: 'portId and yamlContent are required' });
      }

      const currentConfigs = ctx.getCurrentConfigs();

      // Find the config for this portId
      let configIndex = -1;
      for (let i = 0; i < currentConfigs.length; i++) {
        const config = currentConfigs[i];
        if (!config?.serial) continue;

        const pId = normalizePortId(config.serial.portId, 0);
        if (pId === portId) {
          configIndex = i;
          break;
        }
      }

      if (configIndex === -1) {
        return res.status(404).json({ error: 'Port not found', portId });
      }

      // Parse the gallery YAML content
      const galleryYaml = yaml.load(yamlContent) as GallerySnippet;

      if (!galleryYaml) {
        return res.status(400).json({ error: 'Invalid YAML content' });
      }

      // Check minimum version requirement
      const appVersion = await getAppVersion();
      const versionCheck = checkMinVersion(galleryYaml.meta?.min_version, appVersion);
      if (!versionCheck.compatible) {
        return res.status(400).json({
          error: 'Incompatible version',
          message: versionCheck.message,
          minVersion: versionCheck.minVersion,
          appVersion: versionCheck.appVersion,
        });
      }

      const expandedGalleryYaml = expandGalleryTemplate(galleryYaml, parameterValues);
      const missingEntityIds = validateGalleryEntityIds(expandedGalleryYaml.entities);
      const missingAutomationIds = validateGalleryAutomationIds(expandedGalleryYaml.automation);
      const missingScriptIds = validateGalleryScriptIds(expandedGalleryYaml.scripts);
      const missingIds = [...missingEntityIds, ...missingAutomationIds, ...missingScriptIds];
      if (missingIds.length > 0) {
        return res.status(400).json({
          error: 'Invalid gallery content',
          message: `Gallery items must include id. Missing: ${missingIds.join(', ')}`,
        });
      }

      const currentConfig = currentConfigs[configIndex];
      const conflicts: Array<{
        type: 'entity' | 'automation' | 'script';
        entityType?: string;
        id: string;
        existingYaml: string;
        newYaml: string;
      }> = [];
      const matches: Array<{
        type: 'entity';
        entityType?: string;
        id: string;
        matchedId: string;
        existingYaml: string;
        newYaml: string;
        similarity: number;
        candidates: SignatureMatchCandidate[];
      }> = [];
      const newItems: Array<{
        type: 'entity' | 'automation' | 'script';
        entityType?: string;
        id: string;
      }> = [];

      // Check entities for conflicts
      if (expandedGalleryYaml.entities) {
        for (const [entityType, entities] of Object.entries(expandedGalleryYaml.entities)) {
          if (!Array.isArray(entities)) continue;

          const typeKey = entityType as keyof HomenetBridgeConfig;
          if (!ENTITY_TYPE_KEYS.includes(typeKey)) continue;

          const existingList = ((currentConfig[typeKey] as unknown[]) || []) as Record<
            string,
            unknown
          >[];

          for (const entity of entities) {
            if (!entity || typeof entity !== 'object') continue;

            const entityObj = entity as Record<string, unknown>;
            const entityId = entityObj.id as string | undefined;

            if (!entityId) continue;

            // 통합 매칭 로직: 모든 엔티티를 matches 배열에 포함
            // Find all same-type entities as candidates (threshold: 0 to include all)
            const allCandidates = findAllSignatureMatches(entityType, entityObj, existingList, 0);

            // Add existingYaml to each candidate for diff display
            const candidatesWithYaml = allCandidates.map((candidate) => {
              const existingEntity = existingList.find((e) => e.id === candidate.matchId);
              return {
                ...candidate,
                existingYaml: existingEntity ? dumpConfigToYaml(existingEntity) : '',
              };
            });

            // Determine matchedId priority:
            // 1. Exact ID match (Conflict)
            // 2. High similarity match (>= 80%)
            // 3. New item (empty matchedId)
            let matchedId = '';
            let existingYaml = '';
            let similarity: number | undefined;

            const exactMatch = existingList.find((e) => e.id === entityId);
            if (exactMatch) {
              matchedId = entityId;
              existingYaml = dumpConfigToYaml(exactMatch);
              similarity = 1;

              // Ensure exact match is in candidates with 100% similarity
              const candidateIdx = candidatesWithYaml.findIndex((c) => c.matchId === entityId);
              if (candidateIdx === -1) {
                candidatesWithYaml.unshift({
                  matchId: entityId,
                  similarity: 1,
                  existingYaml,
                });
              } else {
                // Update similarity to 1 for exact ID match
                candidatesWithYaml[candidateIdx].similarity = 1;
              }
            } else {
              const highSimCandidate = candidatesWithYaml.find((c) => c.similarity >= 0.8);
              if (highSimCandidate) {
                matchedId = highSimCandidate.matchId;
                existingYaml = highSimCandidate.existingYaml || '';
                similarity = highSimCandidate.similarity;
              }
            }

            matches.push({
              type: 'entity',
              entityType,
              id: entityId,
              matchedId, // Empty if new item
              existingYaml,
              newYaml: dumpConfigToYaml(entityObj),
              similarity: similarity ?? 0,
              candidates: candidatesWithYaml,
            });
          }
        }
      }

      // Check automations for conflicts
      if (expandedGalleryYaml.automation && Array.isArray(expandedGalleryYaml.automation)) {
        const existingAutomations = ((currentConfig as any).automation as unknown[]) || [];

        for (const automation of expandedGalleryYaml.automation) {
          if (!automation || typeof automation !== 'object') continue;

          const automationObj = automation as Record<string, unknown>;
          const automationId = automationObj.id as string | undefined;

          if (!automationId) {
            newItems.push({
              type: 'automation',
              id: 'unnamed',
            });
            continue;
          }

          const existingAutomation = existingAutomations.find((a: any) => a.id === automationId);

          if (existingAutomation) {
            conflicts.push({
              type: 'automation',
              id: automationId,
              existingYaml: dumpConfigToYaml(existingAutomation),
              newYaml: dumpConfigToYaml(automationObj),
            });
          } else {
            newItems.push({
              type: 'automation',
              id: automationId,
            });
          }
        }
      }

      // Check scripts for conflicts
      if (expandedGalleryYaml.scripts && Array.isArray(expandedGalleryYaml.scripts)) {
        const existingScripts = ((currentConfig as any).scripts as unknown[]) || [];

        for (const script of expandedGalleryYaml.scripts) {
          if (!script || typeof script !== 'object') continue;

          const scriptObj = script as Record<string, unknown>;
          const scriptId = scriptObj.id as string | undefined;

          if (!scriptId) {
            newItems.push({
              type: 'script',
              id: 'unnamed',
            });
            continue;
          }

          const existingScript = existingScripts.find((s: any) => s.id === scriptId);

          if (existingScript) {
            conflicts.push({
              type: 'script',
              id: scriptId,
              existingYaml: dumpConfigToYaml(existingScript),
              newYaml: dumpConfigToYaml(scriptObj),
            });
          } else {
            newItems.push({
              type: 'script',
              id: scriptId,
            });
          }
        }
      }

      // Compatibility check: compare vendor requirements with current config
      const compatibility: {
        compatible: boolean;
        mismatches: { field: string; expected: unknown; actual: unknown }[];
      } = {
        compatible: true,
        mismatches: [],
      };

      // Use vendorRequirements from request body (from requirements.json)
      const { vendorRequirements } = req.body as {
        vendorRequirements?: {
          serial?: Record<string, unknown>;
          packet_defaults?: Record<string, unknown>;
        };
      };

      if (vendorRequirements) {
        // Find the serial config for the selected port
        let serialConfig: Record<string, unknown> | null = null;
        if (currentConfig.serial) {
          const pId = normalizePortId(currentConfig.serial.portId, 0);
          if (pId === portId) {
            serialConfig = currentConfig.serial as unknown as Record<string, unknown>;
          }
        }

        // Check serial settings
        if (vendorRequirements.serial && serialConfig) {
          const serialFields = ['baud_rate', 'data_bits', 'parity', 'stop_bits'];
          for (const field of serialFields) {
            const expected = vendorRequirements.serial[field];
            const actual = serialConfig[field];
            if (expected !== undefined && actual !== undefined && expected !== actual) {
              compatibility.compatible = false;
              compatibility.mismatches.push({
                field: `serial.${field}`,
                expected,
                actual,
              });
            }
          }
        }

        // Check packet_defaults
        if (vendorRequirements.packet_defaults) {
          const packetDefaults = (currentConfig as any).packet_defaults || {};
          const packetFields = [
            'rx_length',
            'rx_checksum',
            'tx_checksum',
            'rx_header',
            'tx_header',
            'rx_footer',
            'tx_footer',
          ];

          for (const field of packetFields) {
            const expected = vendorRequirements.packet_defaults[field];
            const actual = packetDefaults[field];

            if (expected !== undefined) {
              // Normalize values: treat empty arrays, null, and undefined as equivalent (empty/default)
              const normalizeValue = (v: unknown): string | unknown => {
                // Empty array, null, or undefined are all considered "empty"
                if (v === null || v === undefined) return '__EMPTY__';
                if (Array.isArray(v) && v.length === 0) return '__EMPTY__';
                if (Array.isArray(v)) return JSON.stringify(v);
                return v;
              };
              if (normalizeValue(expected) !== normalizeValue(actual)) {
                compatibility.compatible = false;
                compatibility.mismatches.push({
                  field: `packet_defaults.${field}`,
                  expected,
                  actual: actual ?? null,
                });
              }
            }
          }
        }
      }

      res.json({ conflicts, matches, newItems, compatibility });
    } catch (error) {
      logger.error({ err: error }, '[gallery] Failed to check conflicts');
      res.status(500).json({ error: error instanceof Error ? error.message : 'Check failed' });
    }
  });

  // Apply gallery snippet to config
  router.post('/api/gallery/apply', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      const { portId, yamlContent, fileName, resolutions, renames, parameterValues } = req.body as {
        portId: string;
        yamlContent: string;
        fileName?: string;
        resolutions?: Record<string, 'overwrite' | 'skip' | 'rename'>;
        renames?: Record<string, string>;
        parameterValues?: Record<string, unknown>;
      };

      if (!portId || !yamlContent) {
        return res.status(400).json({ error: 'portId and yamlContent are required' });
      }

      const currentConfigs = ctx.getCurrentConfigs();
      const currentConfigFiles = ctx.getCurrentConfigFiles();

      // Find the config file for this portId
      let targetConfigFile: string | null = null;
      let configIndex = -1;

      for (let i = 0; i < currentConfigs.length; i++) {
        const config = currentConfigs[i];
        if (!config?.serial) continue;

        const pId = normalizePortId(config.serial.portId, 0);
        if (pId === portId) {
          targetConfigFile = currentConfigFiles[i];
          configIndex = i;
          break;
        }
      }

      if (!targetConfigFile || configIndex === -1) {
        return res.status(404).json({ error: 'Port not found', portId });
      }

      // Parse the gallery YAML content
      const galleryYaml = yaml.load(yamlContent) as GallerySnippet;

      if (!galleryYaml) {
        return res.status(400).json({ error: 'Invalid YAML content' });
      }

      // Check minimum version requirement
      const appVersion = await getAppVersion();
      const versionCheck = checkMinVersion(galleryYaml.meta?.min_version, appVersion);
      if (!versionCheck.compatible) {
        return res.status(400).json({
          error: 'Incompatible version',
          message: versionCheck.message,
          minVersion: versionCheck.minVersion,
          appVersion: versionCheck.appVersion,
        });
      }

      const expandedGalleryYaml = expandGalleryTemplate(galleryYaml, parameterValues);
      const missingEntityIds = validateGalleryEntityIds(expandedGalleryYaml.entities);
      const missingAutomationIds = validateGalleryAutomationIds(expandedGalleryYaml.automation);
      const missingScriptIds = validateGalleryScriptIds(expandedGalleryYaml.scripts);
      const missingIds = [...missingEntityIds, ...missingAutomationIds, ...missingScriptIds];
      if (missingIds.length > 0) {
        return res.status(400).json({
          error: 'Invalid gallery content',
          message: `Gallery items must include id. Missing: ${missingIds.join(', ')}`,
        });
      }

      // Read the current config file
      const configPath = path.join(CONFIG_DIR, targetConfigFile);
      const fileContent = await fs.readFile(configPath, 'utf8');
      const loadedYamlFromFile = yaml.load(fileContent) as {
        homenet_bridge: PersistableHomenetBridgeConfig;
      };

      if (!loadedYamlFromFile.homenet_bridge) {
        return res.status(500).json({ error: 'Invalid config file structure' });
      }

      const normalizedConfig = normalizeConfig(
        loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig,
      );

      // Create backup
      const backupPath = await saveBackup(configPath, loadedYamlFromFile, 'gallery_apply');

      let addedEntities = 0;
      let updatedEntities = 0;
      let skippedEntities = 0;
      let addedAutomations = 0;
      let updatedAutomations = 0;
      let skippedAutomations = 0;
      let addedScripts = 0;
      let updatedScripts = 0;
      let skippedScripts = 0;

      // Add entities from gallery snippet
      if (expandedGalleryYaml.entities) {
        for (const [entityType, entities] of Object.entries(expandedGalleryYaml.entities)) {
          if (!Array.isArray(entities)) continue;

          const typeKey = entityType as keyof HomenetBridgeConfig;
          if (!ENTITY_TYPE_KEYS.includes(typeKey)) {
            logger.warn(`[gallery] Unknown entity type: ${entityType}`);
            continue;
          }

          // Initialize array if not exists
          if (!normalizedConfig[typeKey]) {
            (normalizedConfig as any)[typeKey] = [];
          }

          const targetList = normalizedConfig[typeKey] as unknown[];

          for (const entity of entities) {
            if (!entity || typeof entity !== 'object') continue;

            const entityObj = { ...(entity as Record<string, unknown>) };
            const entityId = entityObj.id as string | undefined;

            if (!entityId) continue;

            const resolution = resolutions?.[entityId] || 'overwrite';
            const renameTarget = renames?.[entityId];

            if (resolution === 'skip') {
              skippedEntities++;
              logger.info(`[gallery] Skipped entity: ${entityId}`);
              continue;
            }

            // Check for existing entity with same ID
            let existingIndex = targetList.findIndex((e: any) => e.id === entityId);

            if (existingIndex === -1 && resolution === 'overwrite' && renameTarget) {
              existingIndex = targetList.findIndex((e: any) => e.id === renameTarget);
              if (existingIndex !== -1) {
                entityObj.id = renameTarget;
              } else {
                logger.warn(
                  `[gallery] Requested overwrite target ${renameTarget} not found for ${entityId}`,
                );
              }
            }

            if (existingIndex !== -1) {
              // Conflict exists - check resolution
              if (resolution === 'rename') {
                const newId = renames?.[entityId];
                if (!newId) {
                  logger.warn(`[gallery] Rename requested but no new ID provided for ${entityId}`);
                  continue;
                }
                // Check if new ID already exists
                const newIdExists = targetList.some((e: any) => e.id === newId);
                if (newIdExists) {
                  logger.warn(`[gallery] New ID ${newId} already exists, skipping`);
                  skippedEntities++;
                  continue;
                }
                entityObj.id = newId;
                targetList.push(entityObj);
                addedEntities++;
                logger.info(`[gallery] Added entity with new ID: ${newId} (was ${entityId})`);
              } else {
                // overwrite
                targetList[existingIndex] = entityObj;
                updatedEntities++;
                logger.info(
                  `[gallery] Updated existing entity: ${(entityObj.id as string | undefined) ?? entityId}`,
                );
              }
            } else {
              // Add new
              const newId = renames?.[entityId];
              if (newId) {
                const newIdExists = targetList.some((e: any) => e.id === newId);
                if (newIdExists) {
                  logger.warn(`[gallery] New ID ${newId} already exists, skipping add`);
                  skippedEntities++;
                  continue;
                }
                entityObj.id = newId;
                targetList.push(entityObj);
                addedEntities++;
                logger.info(
                  `[gallery] Added new entity with custom ID: ${newId} (was ${entityId})`,
                );
              } else {
                targetList.push(entityObj);
                addedEntities++;
                logger.info(`[gallery] Added new entity: ${entityId}`);
              }
            }
          }
        }
      }

      // Add automations from gallery snippet
      if (expandedGalleryYaml.automation && Array.isArray(expandedGalleryYaml.automation)) {
        if (!normalizedConfig.automation) {
          (normalizedConfig as any).automation = [];
        }

        const automationList = (normalizedConfig as any).automation as unknown[];

        for (const automation of expandedGalleryYaml.automation) {
          if (!automation || typeof automation !== 'object') continue;

          const automationObj = { ...(automation as Record<string, unknown>) };
          const automationId = automationObj.id as string | undefined;

          if (automationId) {
            // Check for existing automation with same ID
            const existingIndex = automationList.findIndex((a: any) => a.id === automationId);

            if (existingIndex !== -1) {
              // Conflict exists - check resolution
              const resolution = resolutions?.[automationId] || 'overwrite';

              if (resolution === 'skip') {
                skippedAutomations++;
                logger.info(`[gallery] Skipped automation: ${automationId}`);
                continue;
              } else if (resolution === 'rename') {
                const newId = renames?.[automationId];
                if (!newId) {
                  logger.warn(
                    `[gallery] Rename requested but no new ID provided for ${automationId}`,
                  );
                  continue;
                }
                const newIdExists = automationList.some((a: any) => a.id === newId);
                if (newIdExists) {
                  logger.warn(`[gallery] New ID ${newId} already exists, skipping`);
                  skippedAutomations++;
                  continue;
                }
                automationObj.id = newId;
                automationList.push(automationObj);
                addedAutomations++;
                logger.info(
                  `[gallery] Added automation with new ID: ${newId} (was ${automationId})`,
                );
              } else {
                // overwrite
                automationList[existingIndex] = automationObj;
                updatedAutomations++;
                logger.info(`[gallery] Updated existing automation: ${automationId}`);
              }
            } else {
              // Add new
              const newId = renames?.[automationId];
              if (newId) {
                const newIdExists = automationList.some((a: any) => a.id === newId);
                if (newIdExists) {
                  logger.warn(`[gallery] New ID ${newId} already exists, skipping add`);
                  skippedAutomations++;
                  continue;
                }
                automationObj.id = newId;
                automationList.push(automationObj);
                addedAutomations++;
                logger.info(
                  `[gallery] Added new automation with custom ID: ${newId} (was ${automationId})`,
                );
              } else {
                automationList.push(automationObj);
                addedAutomations++;
                logger.info(`[gallery] Added new automation: ${automationId}`);
              }
            }
          } else {
            automationList.push(automationObj);
            addedAutomations++;
            logger.info('[gallery] Added automation without ID');
          }
        }
      }

      // Add scripts from gallery snippet
      if (expandedGalleryYaml.scripts && Array.isArray(expandedGalleryYaml.scripts)) {
        if (!normalizedConfig.scripts) {
          (normalizedConfig as any).scripts = [];
        }

        const scriptsList = (normalizedConfig as any).scripts as unknown[];

        for (const script of expandedGalleryYaml.scripts) {
          if (!script || typeof script !== 'object') continue;

          const scriptObj = { ...(script as Record<string, unknown>) };
          const scriptId = scriptObj.id as string | undefined;

          if (scriptId) {
            const existingIndex = scriptsList.findIndex((s: any) => s.id === scriptId);

            if (existingIndex !== -1) {
              const resolution = resolutions?.[scriptId] || 'overwrite';

              if (resolution === 'skip') {
                skippedScripts++;
                logger.info(`[gallery] Skipped script: ${scriptId}`);
                continue;
              } else if (resolution === 'rename') {
                const newId = renames?.[scriptId];
                if (!newId) {
                  logger.warn(`[gallery] Rename requested but no new ID provided for ${scriptId}`);
                  continue;
                }
                const newIdExists = scriptsList.some((s: any) => s.id === newId);
                if (newIdExists) {
                  logger.warn(`[gallery] New ID ${newId} already exists, skipping`);
                  skippedScripts++;
                  continue;
                }
                scriptObj.id = newId;
                scriptsList.push(scriptObj);
                addedScripts++;
                logger.info(`[gallery] Added script with new ID: ${newId} (was ${scriptId})`);
              } else {
                scriptsList[existingIndex] = scriptObj;
                updatedScripts++;
                logger.info(`[gallery] Updated existing script: ${scriptId}`);
              }
            } else {
              // Add new
              const newId = renames?.[scriptId];
              if (newId) {
                // Check if new ID already exists
                const newIdExists = scriptsList.some((s: any) => s.id === newId);
                if (newIdExists) {
                  logger.warn(`[gallery] New ID ${newId} already exists, skipping add`);
                  skippedScripts++;
                  continue;
                }
                scriptObj.id = newId;
                scriptsList.push(scriptObj);
                addedScripts++;
                logger.info(
                  `[gallery] Added new script with custom ID: ${newId} (was ${scriptId})`,
                );
              } else {
                scriptsList.push(scriptObj);
                addedScripts++;
                logger.info(`[gallery] Added new script: ${scriptId}`);
              }
            }
          } else {
            scriptsList.push(scriptObj);
            addedScripts++;
            logger.info('[gallery] Added script without ID');
          }
        }
      }

      // Write updated config
      loadedYamlFromFile.homenet_bridge = normalizedConfig;
      const newFileContent = dumpConfigToYaml(loadedYamlFromFile);
      await fs.writeFile(configPath, newFileContent, 'utf8');

      // Update in-memory configs
      ctx.setCurrentRawConfigs(configIndex, normalizedConfig);
      ctx.setCurrentConfigs(configIndex, normalizedConfig);
      ctx.rebuildPortMappings();

      logger.info(
        `[gallery] Applied snippet from ${fileName || 'unknown'}. Added: ${addedEntities} entities, ${addedAutomations} automations, ${addedScripts} scripts. Updated: ${updatedEntities} entities, ${updatedAutomations} automations, ${updatedScripts} scripts. Skipped: ${skippedEntities} entities, ${skippedAutomations} automations, ${skippedScripts} scripts. Backup: ${path.basename(backupPath)}`,
      );

      // Report download to stats worker (fire-and-forget, don't block response)
      if (fileName && STATS_API_KEY) {
        fetch(GALLERY_STATS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': STATS_API_KEY,
          },
          body: JSON.stringify({ snippetId: fileName }),
        }).catch((err) => {
          logger.warn({ err, snippetId: fileName }, '[gallery] Failed to report download stats');
        });
      }

      res.json({
        success: true,
        addedEntities,
        updatedEntities,
        skippedEntities,
        addedAutomations,
        updatedAutomations,
        skippedAutomations,
        addedScripts,
        updatedScripts,
        skippedScripts,
        backup: path.basename(backupPath),
      });
    } catch (error) {
      logger.error({ err: error }, '[gallery] Failed to apply gallery snippet');
      res.status(500).json({ error: error instanceof Error ? error.message : 'Apply failed' });
    }
  });

  return router;
}

export { createGalleryRoutes as default };
