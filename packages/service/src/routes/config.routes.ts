/**
 * Config Routes - handles configuration updates (Editor)
 */

import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { logger, normalizePortId, normalizeConfig } from '@rs485-homenet/core';
import { dumpConfigToYaml } from '../utils/yaml-dumper.js';
import type { HomenetBridgeConfig } from '@rs485-homenet/core';
import type { AutomationConfig, ScriptConfig } from '@rs485-homenet/core/config/types';
import { ENTITY_TYPE_KEYS } from '../utils/constants.js';
import type { RateLimiter } from '../utils/rate-limiter.js';
import type { BridgeInstance, PersistableHomenetBridgeConfig } from '../types/index.js';
import { saveBackup } from '../services/backup.service.js';

export interface ConfigRoutesContext {
  configRateLimiter: RateLimiter;
  getBridges: () => BridgeInstance[];
  getCurrentConfigs: () => HomenetBridgeConfig[];
  getCurrentConfigFiles: () => string[];
  getCurrentRawConfigs: () => HomenetBridgeConfig[];

  configDir: string;
  setCurrentConfigs: (index: number, config: HomenetBridgeConfig) => void;
  setCurrentRawConfigs: (index: number, config: HomenetBridgeConfig) => void;
  rebuildPortMappings: () => void;
}

export function createConfigRoutes(ctx: ConfigRoutesContext): Router {
  const router = Router();

  // --- Helper Functions ---

  const findConfigIndexByPortId = (portId: string): number => {
    const currentConfigs = ctx.getCurrentConfigs();
    for (let i = 0; i < currentConfigs.length; i += 1) {
      const config = currentConfigs[i];
      if (!config.serial) continue;

      const configPortId = normalizePortId(config.serial.portId, 0);
      if (configPortId === portId) {
        return i;
      }
    }
    return -1;
  };

  const findConfigIndexForEntity = (entityId: string): number => {
    const currentConfigs = ctx.getCurrentConfigs();
    for (let i = 0; i < currentConfigs.length; i += 1) {
      const config = currentConfigs[i];
      for (const type of ENTITY_TYPE_KEYS) {
        const entities = config[type] as Array<any> | undefined;
        if (Array.isArray(entities) && entities.some((entity) => entity.id === entityId)) {
          return i;
        }
      }
    }
    return -1;
  };

  const findConfigIndexForAutomation = (automationId: string): number => {
    const currentConfigs = ctx.getCurrentConfigs();
    for (let i = 0; i < currentConfigs.length; i += 1) {
      const config = currentConfigs[i];
      const automations = config.automation;
      if (Array.isArray(automations) && automations.some((a) => a.id === automationId)) {
        return i;
      }
    }
    return -1;
  };

  const findConfigIndexForScript = (scriptId: string): number => {
    const currentConfigs = ctx.getCurrentConfigs();
    for (let i = 0; i < currentConfigs.length; i += 1) {
      const config = currentConfigs[i];
      const scripts = config.scripts;
      if (Array.isArray(scripts) && scripts.some((s) => s.id === scriptId)) {
        return i;
      }
    }
    return -1;
  };

  // --- API Routes ---

  router.get('/api/config/raw/:type/:entityId', (req, res) => {
    const currentRawConfigs = ctx.getCurrentRawConfigs();
    if (currentRawConfigs.length === 0) {
      return res.status(400).json({ error: 'Config not loaded' });
    }

    const { type, entityId } = req.params;
    let foundEntity: any = null;

    if (type === 'entity') {
      for (const rawConfig of currentRawConfigs) {
        for (const entityType of ENTITY_TYPE_KEYS) {
          const entities = rawConfig[entityType] as Array<any> | undefined;
          if (Array.isArray(entities)) {
            foundEntity = entities.find((e) => e.id === entityId);
            if (foundEntity) break;
          }
        }
        if (foundEntity) break;
      }
    } else if (type === 'automation') {
      for (const rawConfig of currentRawConfigs) {
        const automations = rawConfig.automation as Array<any> | undefined;
        if (Array.isArray(automations)) {
          foundEntity = automations.find((automation) => automation.id === entityId);
          if (foundEntity) break;
        }
      }
    } else if (type === 'script') {
      for (const rawConfig of currentRawConfigs) {
        const scripts = rawConfig.scripts as Array<any> | undefined;
        if (Array.isArray(scripts)) {
          foundEntity = scripts.find((script) => script.id === entityId);
          if (foundEntity) break;
        }
      }
    } else {
      return res.status(400).json({ error: 'Unknown config type' });
    }

    if (!foundEntity) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    try {
      const yamlString = dumpConfigToYaml(foundEntity);
      res.json({ yaml: yamlString });
    } catch (err) {
      logger.error({ err }, '[service] Failed to dump config to YAML');
      res.status(500).json({ error: 'Failed to generate YAML' });
    }
  });

  router.post('/api/config/update', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Config update rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const {
      entityId,
      yaml: newEntityYaml,
      portId,
      type = 'entity',
    } = req.body as {
      entityId: string;
      yaml: string;
      portId?: string;
      type?: 'entity' | 'automation' | 'script';
    };

    if (!entityId || typeof entityId !== 'string') {
      return res.status(400).json({ error: 'entityId가 필요합니다.' });
    }

    // Find config by portId if provided, otherwise fallback to finding by entityId
    let configIndex = -1;
    if (type === 'entity') {
      configIndex = portId ? findConfigIndexByPortId(portId) : findConfigIndexForEntity(entityId);
    } else if (type === 'automation') {
      configIndex = findConfigIndexForAutomation(entityId);
    } else if (type === 'script') {
      configIndex = findConfigIndexForScript(entityId);
    } else {
      return res.status(400).json({ error: 'Unknown config type' });
    }
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Entity not found in any loaded config' });
    }

    const currentConfigFiles = ctx.getCurrentConfigFiles();
    const targetConfigFile = currentConfigFiles[configIndex];

    try {
      // 1. Parse new YAML snippet
      let newEntity: any;
      try {
        newEntity = yaml.load(newEntityYaml);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid YAML format' });
      }

      if (!newEntity || typeof newEntity !== 'object') {
        return res.status(400).json({ error: 'Invalid YAML content' });
      }

      if (
        (type === 'automation' || type === 'script') &&
        (!newEntity.id || typeof newEntity.id !== 'string')
      ) {
        return res.status(400).json({ error: 'ID가 필요합니다.' });
      }

      // Ensure ID matches or at least exists
      if (newEntity.id && newEntity.id !== entityId) {
        // Warning: ID changed.
        logger.warn(
          `[service] Entity ID changed from ${entityId} to ${newEntity.id} during update`,
        );
      }

      // 2. Read full config
      const configPath = path.join(ctx.configDir, targetConfigFile);
      const fileContent = await fs.readFile(configPath, 'utf8');
      const loadedYamlFromFile = yaml.load(fileContent) as {
        homenet_bridge: PersistableHomenetBridgeConfig;
      };

      if (!loadedYamlFromFile.homenet_bridge) {
        throw new Error('Invalid config file structure');
      }

      // Normalize the loaded config to ensure IDs are present
      const normalizedFullConfig = normalizeConfig(
        loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig,
      );

      const backupPath = await saveBackup(configPath, loadedYamlFromFile, `${type}_update`);

      if (type === 'entity') {
        // 3. Find and update entity
        let found = false;
        for (const entityType of ENTITY_TYPE_KEYS) {
          const list = normalizedFullConfig[entityType] as any[]; // Use normalizedFullConfig here
          if (Array.isArray(list)) {
            const index = list.findIndex((e) => e.id === entityId);
            if (index !== -1) {
              list[index] = newEntity;
              found = true;
              break;
            }
          }
        }

        if (!found) {
          return res.status(404).json({ error: 'Entity not found in current config' });
        }
      } else if (type === 'automation') {
        const list = normalizedFullConfig.automation as any[] | undefined;
        if (!Array.isArray(list)) {
          return res.status(404).json({ error: 'Automation not found in current config' });
        }
        const index = list.findIndex((automation) => automation.id === entityId);
        if (index === -1) {
          return res.status(404).json({ error: 'Automation not found in current config' });
        }
        list[index] = newEntity;
      } else if (type === 'script') {
        const list = normalizedFullConfig.scripts as any[] | undefined;
        if (!Array.isArray(list)) {
          return res.status(404).json({ error: 'Script not found in current config' });
        }
        const index = list.findIndex((script) => script.id === entityId);
        if (index === -1) {
          return res.status(404).json({ error: 'Script not found in current config' });
        }
        list[index] = newEntity;
      }

      // 4. Update the original object structure with the modified data
      loadedYamlFromFile.homenet_bridge = normalizedFullConfig;

      // 5. Write new config
      const newFileContent = dumpConfigToYaml(loadedYamlFromFile);

      await fs.writeFile(configPath, newFileContent, 'utf8');

      // 6. Update in-memory raw config
      ctx.setCurrentRawConfigs(configIndex, normalizedFullConfig);
      ctx.setCurrentConfigs(configIndex, normalizedFullConfig);
      ctx.rebuildPortMappings();

      const bridges = ctx.getBridges();
      const targetBridge = bridges.find((instance) => instance.configFile === targetConfigFile);

      if (type === 'automation' && targetBridge) {
        const updatedAutomation = newEntity as AutomationConfig;
        if (updatedAutomation.id && updatedAutomation.id !== entityId) {
          targetBridge.bridge.removeAutomation(entityId);
        }
        if (updatedAutomation.enabled === false) {
          targetBridge.bridge.removeAutomation(updatedAutomation.id ?? entityId);
        } else {
          targetBridge.bridge.upsertAutomation(updatedAutomation);
        }
      }

      if (type === 'script' && targetBridge) {
        const updatedScript = newEntity as ScriptConfig;
        if (updatedScript.id && updatedScript.id !== entityId) {
          targetBridge.bridge.removeScript(entityId);
        }
        if (updatedScript.id) {
          targetBridge.bridge.upsertScript(updatedScript);
        }
      }

      logger.info(
        `[service] Config updated for ${type} ${entityId}. Backup created at ${path.basename(
          backupPath,
        )}`,
      );
      res.json({ success: true, backup: path.basename(backupPath) });
    } catch (err) {
      logger.error({ err }, '[service] Failed to update config');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  });

  router.post('/api/config/add', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Config add rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { portId, yaml: newYaml } = req.body as {
      portId: string;
      yaml: string;
    };

    if (!portId || typeof portId !== 'string') {
      return res.status(400).json({ error: 'portId is required' });
    }
    if (!newYaml || typeof newYaml !== 'string') {
      return res.status(400).json({ error: 'yaml is required' });
    }

    const configIndex = findConfigIndexByPortId(portId);
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Config not found for the given portId' });
    }

    const currentConfigFiles = ctx.getCurrentConfigFiles();
    const targetConfigFile = currentConfigFiles[configIndex];

    try {
      // 1. Parse new YAML snippet
      let newItems: any;
      try {
        newItems = yaml.load(newYaml);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid YAML format' });
      }

      if (!newItems || typeof newItems !== 'object') {
        return res.status(400).json({ error: 'Invalid YAML content' });
      }

      // 2. Read full config
      const configPath = path.join(ctx.configDir, targetConfigFile);
      const fileContent = await fs.readFile(configPath, 'utf8');
      const loadedYamlFromFile = yaml.load(fileContent) as {
        homenet_bridge: PersistableHomenetBridgeConfig;
      };

      if (!loadedYamlFromFile.homenet_bridge) {
        throw new Error('Invalid config file structure');
      }

      // Normalize to ensure arrays exist
      const normalizedFullConfig = normalizeConfig(
        loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig,
      );

      const backupPath = await saveBackup(configPath, loadedYamlFromFile, 'add_item');

      // 3. Merge items
      // We iterate over the keys in the newItems and append them to the existing config arrays
      const mergedKeys: string[] = [];

      for (const key of Object.keys(newItems)) {
        // Check if this key is one of the allowed entity types or automation/script
        if (!ENTITY_TYPE_KEYS.includes(key as any) && key !== 'automation' && key !== 'scripts') {
          continue; // Skip unknown top-level keys
        }

        const newEntries = newItems[key];
        if (!Array.isArray(newEntries)) {
          // If user provided a single object instead of array (unlikely with valid schema but possible), wrap it
          // But our schema usually defines these as arrays.
          // If it's not an array, we might want to skip or error.
          // Let's assume standard format matches our schema which are lists.
          continue;
        }

        mergedKeys.push(key);

        const existingList = (normalizedFullConfig as any)[key] || [];
        if (!Array.isArray((normalizedFullConfig as any)[key])) {
          (normalizedFullConfig as any)[key] = existingList;
        }

        // Check for duplicate IDs before appending
        for (const newItem of newEntries) {
          if (newItem.id) {
            const duplicate = existingList.find((existing: any) => existing.id === newItem.id);
            if (duplicate) {
              return res
                .status(409)
                .json({ error: `ID '${newItem.id}' already exists in ${key}.` });
            }
            // Also check against global uniqueness if necessary?
            // For now, uniqueness within the list (and usually within the whole system for entities) is expected.
            // Let's at least check within the current file's relevant lists if it's an entity type

            if (ENTITY_TYPE_KEYS.includes(key as any)) {
              // Check if ID exists in OTHER entity lists in the SAME file
              for (const otherKey of ENTITY_TYPE_KEYS) {
                if (otherKey === key) continue;
                const otherList = (normalizedFullConfig as any)[otherKey];
                if (Array.isArray(otherList) && otherList.some((e: any) => e.id === newItem.id)) {
                  return res
                    .status(409)
                    .json({ error: `ID '${newItem.id}' already exists in ${otherKey}.` });
                }
              }
            }
          }
        }

        (normalizedFullConfig as any)[key].push(...newEntries);
      }

      if (mergedKeys.length === 0) {
        return res.status(400).json({
          error:
            'No valid items found to add. Ensure YAML structure matches root schema keys (e.g. light:, automation:)',
        });
      }

      // 4. Update the original object structure
      loadedYamlFromFile.homenet_bridge = normalizedFullConfig;

      // 5. Write new config
      const newFileContent = dumpConfigToYaml(loadedYamlFromFile);
      await fs.writeFile(configPath, newFileContent, 'utf8');

      // 6. Update in-memory
      ctx.setCurrentRawConfigs(configIndex, normalizedFullConfig);
      ctx.setCurrentConfigs(configIndex, normalizedFullConfig);
      ctx.rebuildPortMappings();

      // We don't hot-reload individual items on "Add" usually, we request restart.
      // But we could try?
      // For now, consistent with requirements: "request restart".

      logger.info(
        `[service] Config added items for ${mergedKeys.join(', ')} in ${portId}. Backup: ${path.basename(backupPath)}`,
      );

      res.json({ success: true, backup: path.basename(backupPath), restartRequired: true });
    } catch (err) {
      logger.error({ err }, '[service] Failed to add config items');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Add failed' });
    }
  });

  return router;
}

export { createConfigRoutes as default };
