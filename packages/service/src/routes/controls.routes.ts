/**
 * Controls Routes - handles commands, automations, and scripts
 */

import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger, normalizePortId, normalizeConfig } from '@rs485-homenet/core';
import { dumpConfigToYaml } from '../utils/yaml-dumper.js';
import type { HomenetBridgeConfig } from '@rs485-homenet/core';
import type { AutomationConfig, ScriptConfig } from '@rs485-homenet/core/config/types';
import type { RateLimiter } from '../utils/rate-limiter.js';
import type {
  BridgeInstance,
  BridgeErrorPayload,
  CommandInfo,
  ConfigStatus,
  PersistableHomenetBridgeConfig,
} from '../types/index.js';
import { formatBridgeErrorMessage } from '../utils/bridge-errors.js';
import { saveBackup } from '../services/backup.service.js';
import { resolveSecurePath } from '../utils/helpers.js';
import yaml from 'js-yaml';

import {
  findConfigIndexByPortId,
  findConfigIndexForEntity,
  findConfigIndexForAutomation,
  findConfigIndexForScript,
  findBridgeForEntity,
} from '../utils/config-helpers.js';

export interface ControlsRoutesContext {
  commandRateLimiter: RateLimiter;
  configRateLimiter: RateLimiter;
  getBridges: () => BridgeInstance[];
  getCurrentConfigs: () => HomenetBridgeConfig[];
  getCurrentConfigFiles: () => string[];
  getCurrentRawConfigs: () => HomenetBridgeConfig[];
  getCurrentConfigStatuses: () => ConfigStatus[];
  getCurrentConfigErrors: () => (BridgeErrorPayload | null)[];

  // Config modification capability
  configDir: string;
  setCurrentConfigs: (index: number, config: HomenetBridgeConfig) => void;
  setCurrentRawConfigs: (index: number, config: HomenetBridgeConfig) => void;
  rebuildPortMappings: () => void;
}

export function createControlsRoutes(ctx: ControlsRoutesContext): Router {
  const router = Router();

  // --- Helper Functions ---

  function extractCommands(config: HomenetBridgeConfig): CommandInfo[] {
    const commands: CommandInfo[] = [];

    // All entity types (same as discovery-manager)
    const entityTypeKeys: (keyof HomenetBridgeConfig & string)[] = [
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

    for (const entityType of entityTypeKeys) {
      const entities = config[entityType] as Array<Record<string, unknown>> | undefined;
      if (!entities) continue;

      for (const entity of entities) {
        const entityId = entity.id as string;
        const entityName = (entity.name as string) || entityId;

        const foundCommands = new Set<string>();

        // Dynamically find all command_* properties in the entity
        for (const key of Object.keys(entity)) {
          if (!key.startsWith('command_')) continue;

          foundCommands.add(key);
          const commandData = entity[key];
          if (!commandData) continue;

          const commandSuffix = key.replace('command_', '');
          const displayCommandName = commandSuffix.charAt(0).toUpperCase() + commandSuffix.slice(1);

          const cmdInfo: CommandInfo = {
            entityId,
            entityName,
            entityType,
            commandName: key,
            displayName: `${entityName} ${displayCommandName}`,
          };

          if (entity.discovery_always === true) {
            cmdInfo.discoveryAlways = true;
          }

          if (typeof entity.discovery_linked_id === 'string') {
            cmdInfo.discoveryLinkedId = entity.discovery_linked_id;
          }

          // Detect input types based on command name and entity type
          if (
            key === 'command_temperature' ||
            key === 'command_speed' ||
            key === 'command_brightness' ||
            key === 'command_percentage' ||
            key === 'command_position'
          ) {
            cmdInfo.inputType = 'number';

            // Get visual config for temperature bounds (climate)
            const visual = entity.visual as
              | { min_temperature?: string; max_temperature?: string; temperature_step?: string }
              | undefined;
            if (visual && key === 'command_temperature') {
              const parseTemp = (val?: string | number) => {
                if (typeof val === 'number') {
                  return Number.isFinite(val) ? val : undefined;
                }

                if (typeof val !== 'string' || val.length === 0) {
                  return undefined;
                }

                const normalized = val.replace(/[^\d.-]/g, '');
                if (!normalized) {
                  return undefined;
                }

                const parsed = Number.parseFloat(normalized);
                return Number.isFinite(parsed) ? parsed : undefined;
              };
              cmdInfo.min = parseTemp(visual.min_temperature) ?? 5;
              cmdInfo.max = parseTemp(visual.max_temperature) ?? 40;
              cmdInfo.step = parseTemp(visual.temperature_step) ?? 1;
            } else if (key === 'command_brightness') {
              cmdInfo.min = 0;
              cmdInfo.max = 255;
              cmdInfo.step = 1;
            } else if (
              key === 'command_percentage' ||
              key === 'command_speed' ||
              key === 'command_position'
            ) {
              cmdInfo.min = 0;
              cmdInfo.max = 100;
              cmdInfo.step = 1;
            }
          }

          // Number entity
          if (entityType === 'number' && key === 'command_number') {
            cmdInfo.inputType = 'number';
            cmdInfo.min = (entity.min_value as number) ?? 0;
            cmdInfo.max = (entity.max_value as number) ?? 100;
            cmdInfo.step = (entity.step as number) ?? 1;
          }

          // Select entity
          if (entityType === 'select' && key === 'command_select') {
            const options = (entity.options as string[]) ?? [];
            cmdInfo.options = options;
            cmdInfo.inputType = options.length > 0 ? 'select' : 'text';
          }

          // Fan preset mode command supports xstr input, optionally with preset modes
          if (key === 'command_preset_mode') {
            const options = (entity.preset_modes as string[]) ?? [];
            cmdInfo.options = options;
            cmdInfo.inputType = options.length > 0 ? 'select' : 'text';
          }

          // Text entity
          if (entityType === 'text' && key === 'command_text') {
            cmdInfo.inputType = 'text';
          }

          commands.push(cmdInfo);
        }

        // Add implicit commands for optimistic switches
        // Optimistic switches without command definitions can still be toggled
        // because the PacketProcessor handles optimistic updates regardless of packet generation
        if (entityType === 'switch' && entity.optimistic === true) {
          if (!foundCommands.has('command_on')) {
            commands.push({
              entityId,
              entityName,
              entityType,
              commandName: 'command_on',
              displayName: `${entityName} On`,
            });
          }

          if (!foundCommands.has('command_off')) {
            commands.push({
              entityId,
              entityName,
              entityType,
              commandName: 'command_off',
              displayName: `${entityName} Off`,
            });
          }
        }
      }
    }

    return commands;
  }

  // --- API Routes ---

  router.get('/api/commands', (_req, res) => {
    const currentConfigs = ctx.getCurrentConfigs();
    const currentConfigFiles = ctx.getCurrentConfigFiles();

    if (currentConfigs.length === 0) {
      return res.status(400).json({ error: 'Config not loaded' });
    }

    const commands = currentConfigs.flatMap((config, index) =>
      extractCommands(config).map((command) => ({
        ...command,
        configFile: currentConfigFiles[index],
      })),
    );
    res.json({ commands });
  });

  router.post('/api/commands/execute', async (req, res) => {
    if (!ctx.commandRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { entityId, commandName, value, portId } = req.body as {
      entityId?: string;
      commandName?: string;
      value?: number | string;
      portId?: string;
    };

    if (!entityId || !commandName) {
      return res.status(400).json({ error: 'entityId and commandName are required' });
    }

    const bridges = ctx.getBridges();
    if (bridges.length === 0) {
      return res.status(400).json({ error: 'Bridge not started' });
    }

    // Convert command_on -> on, command_off -> off, etc.
    const cmdName = commandName.replace('command_', '');

    // Find the target bridge
    const currentConfigFiles = ctx.getCurrentConfigFiles();
    let targetBridge: BridgeInstance | undefined;

    if (portId) {
      const configIndex = findConfigIndexByPortId(ctx.getCurrentConfigs(), portId);
      if (configIndex !== -1) {
        targetBridge = bridges.find(
          (instance) => instance.configFile === currentConfigFiles[configIndex],
        );
      }
    }

    // Fallback to entity-based lookup
    if (!targetBridge) {
      targetBridge = findBridgeForEntity(
        ctx.getCurrentConfigs(),
        ctx.getBridges(),
        ctx.getCurrentConfigFiles(),
        entityId,
      );
    }

    if (targetBridge) {
      const targetIndex = currentConfigFiles.indexOf(targetBridge.configFile);
      const currentConfigStatuses = ctx.getCurrentConfigStatuses();
      const currentConfigErrors = ctx.getCurrentConfigErrors();
      if (targetIndex !== -1 && currentConfigStatuses[targetIndex] === 'error') {
        const errorMessage = formatBridgeErrorMessage(currentConfigErrors[targetIndex]);
        return res.status(503).json({
          error: `Bridge for this entity is not active: ${errorMessage || 'Connection failed'}`,
        });
      }
    }

    if (!targetBridge) {
      // Check if the entity exists in config but bridge is not active
      const configIndex = portId
        ? findConfigIndexByPortId(ctx.getCurrentConfigs(), portId)
        : findConfigIndexForEntity(ctx.getCurrentConfigs(), entityId);

      const currentConfigStatuses = ctx.getCurrentConfigStatuses();
      const currentConfigErrors = ctx.getCurrentConfigErrors();

      if (configIndex !== -1 && currentConfigStatuses[configIndex] === 'error') {
        const errorMessage = formatBridgeErrorMessage(currentConfigErrors[configIndex]);
        return res.status(503).json({
          error: `Bridge for this entity is not active: ${errorMessage || 'Connection failed'}`,
        });
      }
      return res.status(404).json({ error: 'Entity not found in loaded configs' });
    }

    try {
      const result = await targetBridge.bridge.executeCommand(entityId, cmdName, value);
      if (result.success) {
        res.json({ success: true, result });
      } else {
        res.status(500).json({ error: result.error || 'Command execution failed' });
      }
    } catch (err) {
      logger.error({ err }, '[service] Command execution failed');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Execution failed' });
    }
  });

  router.get('/api/automations', (_req, res) => {
    const currentConfigs = ctx.getCurrentConfigs();
    const currentConfigFiles = ctx.getCurrentConfigFiles();

    if (currentConfigs.length === 0) {
      return res.status(400).json({ error: 'Config not loaded' });
    }

    const automations = currentConfigs.flatMap((config, index) => {
      const portId = config.serial ? normalizePortId(config.serial.portId, 0) : 'unknown';
      return (config.automation || []).map((auto: AutomationConfig) => ({
        ...auto,
        portId,
        configFile: currentConfigFiles[index],
      }));
    });
    res.json({ automations });
  });

  router.post('/api/automations/execute', async (req, res) => {
    if (!ctx.commandRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { automationId } = req.body as { automationId?: string };

    if (!automationId) {
      return res.status(400).json({ error: 'automationId가 필요합니다.' });
    }

    const configIndex = findConfigIndexForAutomation(ctx.getCurrentConfigs(), automationId);
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Automation not found in loaded configs' });
    }

    const currentConfigs = ctx.getCurrentConfigs();
    const currentConfigFiles = ctx.getCurrentConfigFiles();

    const automation: AutomationConfig | undefined = currentConfigs[configIndex]?.automation?.find(
      (item: AutomationConfig) => item.id === automationId,
    );
    if (!automation) {
      return res.status(404).json({ error: 'Automation not found in loaded configs' });
    }

    const currentConfigStatuses = ctx.getCurrentConfigStatuses();
    const currentConfigErrors = ctx.getCurrentConfigErrors();
    if (currentConfigStatuses[configIndex] === 'error') {
      const errorMessage = formatBridgeErrorMessage(currentConfigErrors[configIndex]);
      return res.status(503).json({
        error: `Bridge for this automation is not active: ${errorMessage || 'Connection failed'}`,
      });
    }

    const bridges = ctx.getBridges();
    const targetBridge = bridges.find(
      (instance) => instance.configFile === currentConfigFiles[configIndex],
    );

    if (!targetBridge) {
      return res.status(404).json({ error: 'Bridge not started' });
    }

    try {
      const result = await targetBridge.bridge.runAutomationThen(automation);
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (err) {
      logger.error({ err }, '[service] Automation execution failed');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Execution failed' });
    }
  });

  router.patch('/api/automations/:automationId/enabled', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Toggle automation rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { automationId } = req.params;
    const { enabled } = req.body as { enabled?: boolean };

    if (enabled === undefined) {
      return res.status(400).json({ error: 'enabled 값이 필요합니다.' });
    }

    const configIndex = findConfigIndexForAutomation(ctx.getCurrentConfigs(), automationId);
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Automation not found in loaded configs' });
    }

    const currentConfigFiles = ctx.getCurrentConfigFiles();
    const targetConfigFile = currentConfigFiles[configIndex];

    try {
      const configPath = resolveSecurePath(ctx.configDir, targetConfigFile);
      if (!configPath) {
        return res.status(404).json({ error: 'Config file not found' });
      }
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

      const automationList = normalizedConfig.automation;
      if (!Array.isArray(automationList)) {
        return res.status(404).json({ error: 'Automation not found in config' });
      }

      const automation: AutomationConfig | undefined = automationList.find(
        (item) => item.id === automationId,
      );
      if (!automation) {
        return res.status(404).json({ error: 'Automation not found in config' });
      }

      const backupPath = await saveBackup(configPath, loadedYamlFromFile, 'automation_toggle');

      automation.enabled = enabled;

      loadedYamlFromFile.homenet_bridge = normalizedConfig;
      const newFileContent = dumpConfigToYaml(loadedYamlFromFile);
      await fs.writeFile(configPath, newFileContent, 'utf8');

      ctx.setCurrentRawConfigs(configIndex, normalizedConfig);
      ctx.setCurrentConfigs(configIndex, normalizedConfig);
      ctx.rebuildPortMappings();

      const bridges = ctx.getBridges();
      const targetBridge = bridges.find((instance) => instance.configFile === targetConfigFile);
      if (targetBridge) {
        if (enabled) {
          targetBridge.bridge.upsertAutomation(automation);
        } else {
          targetBridge.bridge.removeAutomation(automationId);
        }
      }

      logger.info(
        `[service] Automation ${automationId} enabled set to ${enabled}. Backup created at ${path.basename(
          backupPath,
        )}`,
      );

      res.json({ success: true, automationId, enabled, backup: path.basename(backupPath) });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to toggle automation enabled');
      res.status(500).json({ error: error instanceof Error ? error.message : 'Update failed' });
    }
  });

  router.get('/api/scripts', (_req, res) => {
    const currentConfigs = ctx.getCurrentConfigs();
    const currentConfigFiles = ctx.getCurrentConfigFiles();

    if (currentConfigs.length === 0) {
      return res.status(400).json({ error: 'Config not loaded' });
    }

    const scripts = currentConfigs.flatMap((config, index) => {
      const portId = config.serial ? normalizePortId(config.serial.portId, 0) : 'unknown';
      return (config.scripts || []).map((script: ScriptConfig) => ({
        ...script,
        portId,
        configFile: currentConfigFiles[index],
      }));
    });
    res.json({ scripts });
  });

  router.post('/api/scripts/execute', async (req, res) => {
    if (!ctx.commandRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { scriptId, args } = req.body as { scriptId?: string; args?: Record<string, any> };

    if (!scriptId) {
      return res.status(400).json({ error: 'scriptId가 필요합니다.' });
    }

    const configIndex = findConfigIndexForScript(ctx.getCurrentConfigs(), scriptId);
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Script not found in loaded configs' });
    }

    const currentConfigs = ctx.getCurrentConfigs();
    const currentConfigFiles = ctx.getCurrentConfigFiles();

    const script: ScriptConfig | undefined = currentConfigs[configIndex]?.scripts?.find(
      (item: ScriptConfig) => item.id === scriptId,
    );
    if (!script) {
      return res.status(404).json({ error: 'Script not found in loaded configs' });
    }

    const currentConfigStatuses = ctx.getCurrentConfigStatuses();
    const currentConfigErrors = ctx.getCurrentConfigErrors();
    if (currentConfigStatuses[configIndex] === 'error') {
      const errorMessage = formatBridgeErrorMessage(currentConfigErrors[configIndex]);
      return res.status(503).json({
        error: `Bridge for this script is not active: ${errorMessage || 'Connection failed'}`,
      });
    }

    const bridges = ctx.getBridges();
    const targetBridge = bridges.find(
      (instance) => instance.configFile === currentConfigFiles[configIndex],
    );

    if (!targetBridge) {
      return res.status(404).json({ error: 'Bridge not started' });
    }

    try {
      const result = await targetBridge.bridge.runScript(scriptId, undefined, args);
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (err) {
      logger.error({ err }, '[service] Script execution failed');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Execution failed' });
    }
  });

  router.delete('/api/automations/:automationId', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Delete automation rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { automationId } = req.params;

    const configIndex = findConfigIndexForAutomation(ctx.getCurrentConfigs(), automationId);
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Automation not found in loaded configs' });
    }

    const currentConfigFiles = ctx.getCurrentConfigFiles();
    const targetConfigFile = currentConfigFiles[configIndex];

    try {
      const configPath = resolveSecurePath(ctx.configDir, targetConfigFile);
      if (!configPath) {
        return res.status(404).json({ error: 'Config file not found' });
      }
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

      const automationList = normalizedConfig.automation;
      if (!Array.isArray(automationList)) {
        return res.status(404).json({ error: 'Automation not found in config' });
      }

      const index = automationList.findIndex((item) => item.id === automationId);
      if (index === -1) {
        return res.status(404).json({ error: 'Automation not found in config' });
      }

      const backupPath = await saveBackup(configPath, loadedYamlFromFile, 'automation_delete');

      automationList.splice(index, 1);

      loadedYamlFromFile.homenet_bridge = normalizedConfig;
      const newFileContent = dumpConfigToYaml(loadedYamlFromFile);
      await fs.writeFile(configPath, newFileContent, 'utf8');

      ctx.setCurrentRawConfigs(configIndex, normalizedConfig);
      ctx.setCurrentConfigs(configIndex, normalizedConfig);
      ctx.rebuildPortMappings();

      const bridges = ctx.getBridges();
      const targetBridge = bridges.find((instance) => instance.configFile === targetConfigFile);
      if (targetBridge) {
        targetBridge.bridge.removeAutomation(automationId);
      }

      logger.info(
        `[service] Automation ${automationId} deleted. Backup created at ${path.basename(backupPath)}`,
      );
      res.json({ success: true, backup: path.basename(backupPath) });
    } catch (err) {
      logger.error({ err }, '[service] Failed to delete automation');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });

  router.delete('/api/scripts/:scriptId', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Delete script rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { scriptId } = req.params;

    const configIndex = findConfigIndexForScript(ctx.getCurrentConfigs(), scriptId);
    if (configIndex === -1) {
      return res.status(404).json({ error: 'Script not found in loaded configs' });
    }

    const currentConfigFiles = ctx.getCurrentConfigFiles();
    const targetConfigFile = currentConfigFiles[configIndex];

    try {
      const configPath = resolveSecurePath(ctx.configDir, targetConfigFile);
      if (!configPath) {
        return res.status(404).json({ error: 'Config file not found' });
      }
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

      const scriptsList = normalizedConfig.scripts;
      if (!Array.isArray(scriptsList)) {
        return res.status(404).json({ error: 'Script not found in config' });
      }

      const index = scriptsList.findIndex((item) => item.id === scriptId);
      if (index === -1) {
        return res.status(404).json({ error: 'Script not found in config' });
      }

      const backupPath = await saveBackup(configPath, loadedYamlFromFile, 'script_delete');

      scriptsList.splice(index, 1);

      loadedYamlFromFile.homenet_bridge = normalizedConfig;
      const newFileContent = dumpConfigToYaml(loadedYamlFromFile);
      await fs.writeFile(configPath, newFileContent, 'utf8');

      ctx.setCurrentRawConfigs(configIndex, normalizedConfig);
      ctx.setCurrentConfigs(configIndex, normalizedConfig);
      ctx.rebuildPortMappings();

      const bridges = ctx.getBridges();
      const targetBridge = bridges.find((instance) => instance.configFile === targetConfigFile);
      if (targetBridge) {
        // Safe check: if method exists call it.
        if (typeof targetBridge.bridge.removeScript === 'function') {
          targetBridge.bridge.removeScript(scriptId);
        }
      }

      logger.info(
        `[service] Script ${scriptId} deleted. Backup created at ${path.basename(backupPath)}`,
      );
      res.json({ success: true, backup: path.basename(backupPath) });
    } catch (err) {
      logger.error({ err }, '[service] Failed to delete script');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });

  return router;
}

export { createControlsRoutes as default };
