/**
 * Entities Routes - handles entity management API endpoints
 */

import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger, normalizeConfig, normalizePortId } from '@rs485-homenet/core';
import type { HomenetBridgeConfig } from '@rs485-homenet/core';
import { dumpConfigToYaml } from '../utils/yaml-dumper.js';
import { ENTITY_TYPE_KEYS } from '../utils/constants.js';
import { saveBackup } from '../services/backup.service.js';
import type { RateLimiter } from '../utils/rate-limiter.js';
import type {
  BridgeInstance,
  ConfigEntityInfo,
  PersistableHomenetBridgeConfig,
} from '../types/index.js';
import yaml from 'js-yaml';

export interface EntitiesRoutesContext {
  configRateLimiter: RateLimiter;
  getBridges: () => BridgeInstance[];
  getCurrentConfigs: () => HomenetBridgeConfig[];
  getCurrentConfigFiles: () => string[];
  getCurrentRawConfigs: () => HomenetBridgeConfig[];
  setCurrentConfigs: (index: number, config: HomenetBridgeConfig) => void;
  setCurrentRawConfigs: (index: number, config: HomenetBridgeConfig) => void;
  rebuildPortMappings: () => void;
  triggerRestart: () => Promise<void>;
  configDir: string;
}

export function createEntitiesRoutes(ctx: EntitiesRoutesContext): Router {
  const router = Router();

  // --- Helper Functions ---

  function extractEntities(config: HomenetBridgeConfig): ConfigEntityInfo[] {
    const entities: ConfigEntityInfo[] = [];

    for (const entityType of ENTITY_TYPE_KEYS) {
      const list = config[entityType] as Array<Record<string, unknown>> | undefined;
      if (!list) continue;

      for (const entity of list) {
        const entityId = entity.id as string;
        if (!entityId) continue;

        const entityName = (entity.name as string) || entityId;
        const portId = typeof entity.portId === 'string' ? entity.portId : undefined;

        const info: ConfigEntityInfo = {
          entityId,
          entityName,
          entityType: entityType as string,
          portId,
          internal: entity.internal === true,
        };

        if (entity.discovery_always === true) {
          info.discoveryAlways = true;
        }

        if (typeof entity.discovery_linked_id === 'string') {
          info.discoveryLinkedId = entity.discovery_linked_id;
        }

        entities.push(info);
      }
    }

    return entities;
  }

  const findConfigIndexByPortId = (portId: string): number => {
    const currentConfigs = ctx.getCurrentConfigs();
    for (let i = 0; i < currentConfigs.length; i += 1) {
      const config = currentConfigs[i];
      if (!config.serial) continue;

      const configPortId = normalizePortId(config.serial.portId, i);
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

  const findBridgeForEntity = (entityId: string): BridgeInstance | undefined => {
    const currentConfigs = ctx.getCurrentConfigs();
    const currentConfigFiles = ctx.getCurrentConfigFiles();
    const bridges = ctx.getBridges();
    for (let i = 0; i < currentConfigs.length; i += 1) {
      const config = currentConfigs[i];
      for (const type of ENTITY_TYPE_KEYS) {
        const entities = config[type] as Array<any> | undefined;
        if (Array.isArray(entities) && entities.some((entity) => entity.id === entityId)) {
          return bridges.find((instance) => instance.configFile === currentConfigFiles[i]);
        }
      }
    }

    return undefined;
  };

  // --- API Routes ---

  router.get('/api/entities', (_req, res) => {
    const currentConfigs = ctx.getCurrentConfigs();
    const currentConfigFiles = ctx.getCurrentConfigFiles();

    if (currentConfigs.length === 0) {
      return res.status(400).json({ error: 'Config not loaded' });
    }

    const entities = currentConfigs.flatMap((config, index) =>
      extractEntities(config).map((entity) => ({
        ...entity,
        configFile: currentConfigFiles[index],
      })),
    );
    res.json({ entities });
  });

  router.post('/api/entities/rename', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Rename entity rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const {
      entityId,
      newName,
      portId,
      updateObjectId = true,
    } = req.body as {
      entityId?: string;
      newName?: string;
      portId?: string;
      updateObjectId?: boolean;
    };

    if (!entityId || typeof entityId !== 'string') {
      return res.status(400).json({ error: 'entityId가 필요합니다.' });
    }

    if (!newName || typeof newName !== 'string' || !newName.trim()) {
      return res.status(400).json({ error: '새 이름을 입력해주세요.' });
    }

    // Find config by portId if provided, otherwise fallback to finding by entityId
    const configIndex = portId
      ? findConfigIndexByPortId(portId)
      : findConfigIndexForEntity(entityId);
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Entity not found in any loaded config' });
    }

    const currentConfigFiles = ctx.getCurrentConfigFiles();
    const targetConfigFile = currentConfigFiles[configIndex];

    try {
      const configPath = path.join(ctx.configDir, targetConfigFile);
      const fileContent = await fs.readFile(configPath, 'utf8');
      const loadedYamlFromFile = yaml.load(fileContent) as {
        homenet_bridge: PersistableHomenetBridgeConfig;
      };

      if (!loadedYamlFromFile.homenet_bridge) {
        throw new Error('Invalid config file structure');
      }

      const normalizedConfig = normalizeConfig(
        loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig,
      );

      let targetEntity: any | null = null;
      for (const type of ENTITY_TYPE_KEYS) {
        const list = normalizedConfig[type] as any[] | undefined;
        if (!Array.isArray(list)) continue;
        const found = list.find((entry) => entry.id === entityId);
        if (found) {
          targetEntity = found;
          break;
        }
      }

      if (!targetEntity) {
        return res.status(404).json({ error: 'Entity not found in current config' });
      }

      const backupPath = await saveBackup(configPath, loadedYamlFromFile, 'entity_rename');

      const trimmedName = newName.trim();
      const configPortId = normalizedConfig.serial?.portId ?? 'default';
      const uniqueId = targetEntity.unique_id || `homenet_${configPortId}_${entityId}`;
      targetEntity.name = trimmedName;
      if (!targetEntity.unique_id) {
        targetEntity.unique_id = uniqueId;
      }

      loadedYamlFromFile.homenet_bridge = normalizedConfig;

      const newFileContent = dumpConfigToYaml(loadedYamlFromFile);

      await fs.writeFile(configPath, newFileContent, 'utf8');

      ctx.setCurrentRawConfigs(configIndex, normalizedConfig);
      ctx.setCurrentConfigs(configIndex, normalizedConfig);
      ctx.rebuildPortMappings();

      const bridges = ctx.getBridges();
      const targetBridge = bridges.find((instance) => instance.configFile === targetConfigFile);
      targetBridge?.bridge.renameEntity(entityId, trimmedName, uniqueId, updateObjectId);

      logger.info(
        `[service] Entity ${entityId} renamed to '${trimmedName}'. Backup created at ${path.basename(backupPath)}`,
      );

      res.json({
        success: true,
        entityId,
        newName: trimmedName,
        uniqueId,
        backup: path.basename(backupPath),
      });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to rename entity');
      res.status(500).json({ error: error instanceof Error ? error.message : 'Rename failed' });
    }
  });

  router.patch('/api/entities/:entityId/discovery-always', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Toggle discovery_always rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { entityId } = req.params;
    const { enabled, portId } = req.body as { enabled?: boolean; portId?: string };

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }

    // Find config by portId if provided, otherwise fallback to finding by entityId
    const configIndex = portId
      ? findConfigIndexByPortId(portId)
      : findConfigIndexForEntity(entityId);
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Entity not found in any loaded config' });
    }

    const currentConfigFiles = ctx.getCurrentConfigFiles();
    const targetConfigFile = currentConfigFiles[configIndex];

    try {
      const configPath = path.join(ctx.configDir, targetConfigFile);
      const fileContent = await fs.readFile(configPath, 'utf8');
      const loadedYamlFromFile = yaml.load(fileContent) as {
        homenet_bridge: PersistableHomenetBridgeConfig;
      };

      if (!loadedYamlFromFile.homenet_bridge) {
        throw new Error('Invalid config file structure');
      }

      const normalizedConfig = normalizeConfig(
        loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig,
      );

      let targetEntity: any | null = null;
      for (const type of ENTITY_TYPE_KEYS) {
        const list = normalizedConfig[type] as any[] | undefined;
        if (!Array.isArray(list)) continue;
        const found = list.find((entry) => entry.id === entityId);
        if (found) {
          targetEntity = found;
          break;
        }
      }

      if (!targetEntity) {
        return res.status(404).json({ error: 'Entity not found in current config' });
      }

      // Backup
      const backupPath = await saveBackup(
        configPath,
        loadedYamlFromFile,
        'entity_discovery_toggle',
      );

      // Update or remove discovery_always based on enabled flag
      if (enabled) {
        targetEntity.discovery_always = true;
      } else {
        delete targetEntity.discovery_always;
      }

      loadedYamlFromFile.homenet_bridge = normalizedConfig;

      const newFileContent = dumpConfigToYaml(loadedYamlFromFile);

      await fs.writeFile(configPath, newFileContent, 'utf8');

      ctx.setCurrentRawConfigs(configIndex, normalizedConfig);
      ctx.setCurrentConfigs(configIndex, normalizedConfig);
      ctx.rebuildPortMappings();

      logger.info(
        `[service] Entity ${entityId} discovery_always set to ${enabled}. Backup created at ${path.basename(backupPath)}`,
      );

      res.json({
        success: true,
        entityId,
        discoveryAlways: enabled,
        backup: path.basename(backupPath),
      });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to toggle discovery_always');
      res.status(500).json({ error: error instanceof Error ? error.message : 'Update failed' });
    }
  });

  router.post('/api/entities/:entityId/revoke-discovery', (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { entityId } = req.params;
    if (!entityId) return res.status(400).json({ error: 'entityId required' });

    const bridgeInstance = findBridgeForEntity(entityId);
    if (!bridgeInstance) {
      return res.status(404).json({ error: 'Entity not found or bridge not active' });
    }

    const result = bridgeInstance.bridge.revokeDiscovery(entityId);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: result.error });
    }
  });

  router.delete('/api/entities/:entityId', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Delete entity rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { entityId } = req.params;
    const portId = req.query.portId as string | undefined;

    // Find config by portId if provided, otherwise fallback to finding by entityId
    const configIndex = portId
      ? findConfigIndexByPortId(portId)
      : findConfigIndexForEntity(entityId);
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Entity not found in any loaded config' });
    }

    const currentConfigFiles = ctx.getCurrentConfigFiles();
    const targetConfigFile = currentConfigFiles[configIndex];

    try {
      const configPath = path.join(ctx.configDir, targetConfigFile);
      const fileContent = await fs.readFile(configPath, 'utf8');
      const loadedYamlFromFile = yaml.load(fileContent) as {
        homenet_bridge: PersistableHomenetBridgeConfig;
      };

      if (!loadedYamlFromFile.homenet_bridge) {
        throw new Error('Invalid config file structure');
      }

      // Normalize to ensure we can match IDs accurately
      const normalizedConfig = normalizeConfig(
        loadedYamlFromFile.homenet_bridge as HomenetBridgeConfig,
      );

      // Backup
      const backupPath = await saveBackup(configPath, loadedYamlFromFile, 'entity_delete');

      let found = false;
      for (const type of ENTITY_TYPE_KEYS) {
        const list = normalizedConfig[type] as any[];
        if (Array.isArray(list)) {
          const index = list.findIndex((e) => e.id === entityId);
          if (index !== -1) {
            list.splice(index, 1);
            found = true;
            break;
          }
        }
      }

      if (!found) {
        return res.status(404).json({ error: 'Entity not found in config' });
      }

      // Update the original object structure with the modified data
      loadedYamlFromFile.homenet_bridge = normalizedConfig;

      // Write new config
      const newFileContent = dumpConfigToYaml(loadedYamlFromFile);

      await fs.writeFile(configPath, newFileContent, 'utf8');

      // Update in-memory config
      ctx.setCurrentRawConfigs(configIndex, normalizedConfig);
      ctx.setCurrentConfigs(configIndex, normalizedConfig);
      ctx.rebuildPortMappings();

      logger.info(
        `[service] Entity ${entityId} deleted. Backup created at ${path.basename(backupPath)}`,
      );
      res.json({ success: true, backup: path.basename(backupPath) });
    } catch (err) {
      logger.error({ err }, '[service] Failed to delete entity');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });

  return router;
}

export { createEntitiesRoutes as default };
