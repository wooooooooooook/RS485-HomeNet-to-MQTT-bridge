/**
 * Gallery Routes - handles gallery snippet API endpoints
 */

import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { HomenetBridgeConfig, logger, normalizeConfig, normalizePortId } from '@rs485-homenet/core';
import { processGalleryTemplate } from '../utils/gallery-template.js';
import { dumpConfigToYaml } from '../utils/yaml-dumper.js';
import {
  CONFIG_DIR,
  GALLERY_RAW_BASE_URL,
  GALLERY_LIST_URL,
  ENTITY_TYPE_KEYS,
} from '../utils/constants.js';
import { saveBackup } from '../services/backup.service.js';
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
}

export function createGalleryRoutes(ctx: GalleryRoutesContext): Router {
  const router = Router();

  // Get gallery list from GitHub
  router.get('/api/gallery/list', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
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

  // Check for conflicts before applying gallery snippet
  router.post('/api/gallery/check-conflicts', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      const { portId, yamlContent, parameters } = req.body;

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
      let galleryYaml = yaml.load(yamlContent) as {
        meta?: Record<string, unknown>;
        entities?: Record<string, unknown[]>;
        automation?: unknown[];
        scripts?: unknown[];
        parameters?: unknown[];
      };

      if (!galleryYaml) {
        return res.status(400).json({ error: 'Invalid YAML content' });
      }

      // Process template if parameters exist in schema or are provided
      if (galleryYaml.parameters || (parameters && Object.keys(parameters).length > 0)) {
        try {
          galleryYaml = processGalleryTemplate(galleryYaml, parameters || {});
        } catch (e) {
          logger.error({ err: e }, '[gallery] Failed to process gallery template');
          return res.status(400).json({ error: 'Failed to process template: ' + (e instanceof Error ? e.message : String(e)) });
        }
      }

      const currentConfig = currentConfigs[configIndex];
      const conflicts: Array<{
        type: 'entity' | 'automation' | 'script';
        entityType?: string;
        id: string;
        existingYaml: string;
        newYaml: string;
      }> = [];
      const newItems: Array<{
        type: 'entity' | 'automation' | 'script';
        entityType?: string;
        id: string;
      }> = [];

      // Check entities for conflicts
      if (galleryYaml.entities) {
        for (const [entityType, entities] of Object.entries(galleryYaml.entities)) {
          if (!Array.isArray(entities)) continue;

          const typeKey = entityType as keyof HomenetBridgeConfig;
          if (!ENTITY_TYPE_KEYS.includes(typeKey)) continue;

          const existingList = (currentConfig[typeKey] as unknown[]) || [];

          for (const entity of entities) {
            if (!entity || typeof entity !== 'object') continue;

            const entityObj = entity as Record<string, unknown>;
            const entityId = entityObj.id as string | undefined;

            if (!entityId) continue;

            const existingEntity = existingList.find((e: any) => e.id === entityId);

            if (existingEntity) {
              conflicts.push({
                type: 'entity',
                entityType,
                id: entityId,
                existingYaml: dumpConfigToYaml(existingEntity),
                newYaml: dumpConfigToYaml(entityObj),
              });
            } else {
              newItems.push({
                type: 'entity',
                entityType,
                id: entityId,
              });
            }
          }
        }
      }

      // Check automations for conflicts
      if (galleryYaml.automation && Array.isArray(galleryYaml.automation)) {
        const existingAutomations = ((currentConfig as any).automation as unknown[]) || [];

        for (const automation of galleryYaml.automation) {
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
      if (galleryYaml.scripts && Array.isArray(galleryYaml.scripts)) {
        const existingScripts = ((currentConfig as any).scripts as unknown[]) || [];

        for (const script of galleryYaml.scripts) {
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

      res.json({ conflicts, newItems, compatibility });
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
      const { portId, yamlContent, parameters, fileName, resolutions, renames } = req.body as {
        portId: string;
        yamlContent: string;
        parameters?: Record<string, any>;
        fileName?: string;
        resolutions?: Record<string, 'overwrite' | 'skip' | 'rename'>;
        renames?: Record<string, string>;
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
      let galleryYaml = yaml.load(yamlContent) as {
        meta?: Record<string, unknown>;
        entities?: Record<string, unknown[]>;
        automation?: unknown[];
        scripts?: unknown[];
        parameters?: unknown[];
      };

      if (!galleryYaml) {
        return res.status(400).json({ error: 'Invalid YAML content' });
      }

      // Process template if parameters exist in schema or are provided
      if (galleryYaml.parameters || (parameters && Object.keys(parameters).length > 0)) {
        try {
          galleryYaml = processGalleryTemplate(galleryYaml, parameters || {});
        } catch (e) {
          logger.error({ err: e }, '[gallery] Failed to process gallery template');
          return res.status(400).json({ error: 'Failed to process template: ' + (e instanceof Error ? e.message : String(e)) });
        }
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
      if (galleryYaml.entities) {
        for (const [entityType, entities] of Object.entries(galleryYaml.entities)) {
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

            // Check for existing entity with same ID
            const existingIndex = targetList.findIndex((e: any) => e.id === entityId);

            if (existingIndex !== -1) {
              // Conflict exists - check resolution
              const resolution = resolutions?.[entityId] || 'overwrite';

              if (resolution === 'skip') {
                skippedEntities++;
                logger.info(`[gallery] Skipped entity: ${entityId}`);
                continue;
              } else if (resolution === 'rename') {
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
                logger.info(`[gallery] Updated existing entity: ${entityId}`);
              }
            } else {
              targetList.push(entityObj);
              addedEntities++;
              logger.info(`[gallery] Added new entity: ${entityId}`);
            }
          }
        }
      }

      // Add automations from gallery snippet
      if (galleryYaml.automation && Array.isArray(galleryYaml.automation)) {
        if (!normalizedConfig.automation) {
          (normalizedConfig as any).automation = [];
        }

        const automationList = (normalizedConfig as any).automation as unknown[];

        for (const automation of galleryYaml.automation) {
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
              automationList.push(automationObj);
              addedAutomations++;
              logger.info(`[gallery] Added new automation: ${automationId}`);
            }
          } else {
            automationList.push(automationObj);
            addedAutomations++;
            logger.info('[gallery] Added automation without ID');
          }
        }
      }

      // Add scripts from gallery snippet
      if (galleryYaml.scripts && Array.isArray(galleryYaml.scripts)) {
        if (!normalizedConfig.scripts) {
          (normalizedConfig as any).scripts = [];
        }

        const scriptsList = (normalizedConfig as any).scripts as unknown[];

        for (const script of galleryYaml.scripts) {
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
              scriptsList.push(scriptObj);
              addedScripts++;
              logger.info(`[gallery] Added new script: ${scriptId}`);
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
