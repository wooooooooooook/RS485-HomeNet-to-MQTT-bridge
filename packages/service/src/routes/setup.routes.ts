import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { type HomenetBridgeConfig, normalizeConfig, normalizePortId } from '@rs485-homenet/core';
import {
  type SetupWizardService,
  EMPTY_CONFIG_SENTINEL,
  DEFAULT_PACKET_DEFAULTS,
  ENTITY_TYPE_KEYS,
} from '../services/setup.service.js';

export interface SetupRoutesContext {
  setupWizardService: SetupWizardService;
}

export function createSetupRoutes(ctx: SetupRoutesContext): Router {
  const router = Router();
  const { setupWizardService } = ctx;
  const {
    deps: {
      configDir,
      examplesDir,
      envConfigFilesSource,
      defaultConfigFilename,
      configRestartFlag,
      serialTestRateLimiter,
      configRateLimiter,
      logger,
      dumpConfigToYaml,
      saveBackup,
      fileExists,
    },
    getInitializationState,
    listExampleConfigs,
    getNextConfigFilename,
    checkDuplicateSerial,
    applySerialPathToConfig,
    parseSerialConfigPayload,
    buildEmptyConfig,
    extractSerialConfig,
    collectSerialPackets,
  } = setupWizardService;

  let isSerialTestRunning = false;

  router.get('/api/config/examples', async (_req, res) => {
    try {
      const [state, examples] = await Promise.all([getInitializationState(), listExampleConfigs()]);

      res.json({
        configRoot: configDir,
        examples,
        defaultConfigName: state.defaultConfigName,
        requiresInitialization: state.requiresInitialization,
        hasInitMarker: state.hasInitMarker,
        hasCustomConfig: envConfigFilesSource !== 'default',
      });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to list example configs');
      res.status(500).json({ error: '예제 설정을 불러오지 못했습니다.' });
    }
  });

  router.get('/api/config/examples/:filename/serial', async (req, res) => {
    try {
      const { filename } = req.params;

      if (!filename || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'INVALID_FILENAME' });
      }

      const examples = await listExampleConfigs();
      if (!examples.includes(filename)) {
        return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
      }

      const sourcePath = path.join(examplesDir, filename);

      try {
        const rawContent = await fs.readFile(sourcePath, 'utf-8');
        const parsedConfig = yaml.load(rawContent) as Record<string, unknown>;

        const bridgeConfig =
          parsedConfig.homenet_bridge || parsedConfig.homenetBridge || parsedConfig;

        if (!bridgeConfig || typeof bridgeConfig !== 'object') {
          return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
        }

        const bridgeObj = bridgeConfig as Record<string, unknown>;
        let serialConfig: Record<string, unknown> | null = null;

        if (bridgeObj.serial && typeof bridgeObj.serial === 'object') {
          serialConfig = bridgeObj.serial as Record<string, unknown>;
        }

        const packetDefaults = bridgeObj.packet_defaults || DEFAULT_PACKET_DEFAULTS;

        if (!serialConfig) {
          return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
        }

        // Exclude 'path' from response as user needs to enter this
        const { path: _path, ...serialSettings } = serialConfig;

        res.json({
          ok: true,
          serial: serialSettings,
          packetDefaults,
        });
      } catch (error) {
        logger.error(
          { err: error, sourcePath },
          '[service] Failed to read example config for serial info',
        );
        return res.status(500).json({ error: 'EXAMPLE_READ_FAILED' });
      }
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to get example serial config');
      res.status(500).json({ error: 'UNKNOWN_ERROR' });
    }
  });

  router.get('/api/config/examples/:filename/entities', async (req, res) => {
    try {
      const { filename } = req.params;

      if (!filename || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'INVALID_FILENAME' });
      }

      const examples = await listExampleConfigs();
      if (!examples.includes(filename)) {
        return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
      }

      const sourcePath = path.join(examplesDir, filename);
      let parsedConfig: Record<string, any>;

      try {
        const rawContent = await fs.readFile(sourcePath, 'utf-8');
        parsedConfig = yaml.load(rawContent) as Record<string, any>;
      } catch (error) {
        logger.error(
          { err: error, sourcePath },
          '[service] Failed to read example config for entities',
        );
        return res.status(500).json({ error: 'EXAMPLE_READ_FAILED' });
      }

      const bridgeConfig =
        parsedConfig.homenet_bridge || parsedConfig.homenetBridge || parsedConfig;

      // Normalize to ensure IDs are generated
      try {
        normalizeConfig(parsedConfig as HomenetBridgeConfig);
      } catch (e) {
        // Ignore validation errors, we just want ID generation
      }

      if (!bridgeConfig || typeof bridgeConfig !== 'object') {
        return res.status(200).json({ entities: {} });
      }

      const entities: Record<string, any[]> = {};

      for (const type of ENTITY_TYPE_KEYS) {
        const items = bridgeConfig[type];
        if (Array.isArray(items) && items.length > 0) {
          entities[type] = items.map((item: any) => ({
            id: item.id,
            name: item.name || item.id,
          }));
        }
      }

      res.json({ entities });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to get example entities');
      res.status(500).json({ error: 'UNKNOWN_ERROR' });
    }
  });

  router.post('/api/config/examples/test-serial', async (req, res) => {
    if (!serialTestRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Serial test rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    if (isSerialTestRunning) {
      return res.status(409).json({ error: 'TEST_ALREADY_RUNNING' });
    }
    isSerialTestRunning = true;

    try {
      const { filename, serialPath, serialConfig, portId } = req.body || {};

      if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'INVALID_FILENAME' });
      }

      if (filename === EMPTY_CONFIG_SENTINEL) {
        const parsed = parseSerialConfigPayload(serialConfig);
        if (!parsed.serialConfig) {
          return res.status(400).json({ error: parsed.error });
        }

        const packets = await collectSerialPackets(parsed.serialConfig.path, parsed.serialConfig, {
          maxPackets: 10,
          timeoutMs: 3000,
        });

        res.json({
          ok: true,
          portId: normalizePortId(parsed.serialConfig.portId || 'raw', 0),
          packets,
        });
        return;
      }

      if (typeof serialPath !== 'string' || !serialPath.trim()) {
        return res.status(400).json({ error: 'SERIAL_PATH_REQUIRED' });
      }

      const examples = await listExampleConfigs();
      if (!examples.includes(filename)) {
        return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
      }

      const sourcePath = path.join(examplesDir, filename);
      let parsedConfig: unknown;

      try {
        const rawContent = await fs.readFile(sourcePath, 'utf-8');
        parsedConfig = yaml.load(rawContent);
      } catch (error) {
        logger.error(
          { err: error, sourcePath },
          '[service] Failed to read example config for test',
        );
        return res.status(500).json({ error: 'EXAMPLE_READ_FAILED' });
      }

      const serialPathValue = serialPath.trim();
      const portIdValue = typeof portId === 'string' ? portId.trim() : undefined;

      if (!applySerialPathToConfig(parsedConfig, serialPathValue, portIdValue)) {
        return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
      }

      const bridgeConfig =
        (parsedConfig as Record<string, unknown>).homenet_bridge ||
        (parsedConfig as Record<string, unknown>).homenetBridge ||
        parsedConfig;

      const normalized = normalizeConfig(
        JSON.parse(JSON.stringify(bridgeConfig)) as HomenetBridgeConfig,
      );
      const serialConfigValue = extractSerialConfig(normalized);

      if (!serialConfigValue) {
        return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
      }

      const packets = await collectSerialPackets(serialPathValue, serialConfigValue, {
        maxPackets: 10,
        timeoutMs: 3000,
      });

      res.json({
        ok: true,
        portId: normalizePortId(serialConfigValue.portId || 'raw', 0),
        packets,
      });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to test serial path during setup');
      const err = error as Error & { code?: string };
      res.status(500).json({
        error: 'SERIAL_TEST_FAILED',
        details: err.code || err.message || 'Unknown error',
      });
    } finally {
      isSerialTestRunning = false;
    }
  });

  router.post('/api/config/check-duplicate-serial', async (req, res) => {
    try {
      const { serialPath, portId } = req.body || {};
      const validation = await checkDuplicateSerial(serialPath, portId);
      if (validation) {
        return res.status(400).json({ error: validation.error });
      }
      res.json({ ok: true });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to check duplicate serial');
      res.status(500).json({ error: 'UNKNOWN_ERROR' });
    }
  });

  router.post('/api/config/examples/select', async (req, res) => {
    if (configRateLimiter && !configRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Setup wizard rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    try {
      // Use getInitializationState directly to ensure we have fresh state if needed,
      // though the logic below has been relaxed as per previous code.
      // const state = await getInitializationState();

      const { filename, serialPath, serialConfig, portId, packetDefaults, selectedEntities, mode } =
        req.body || {};

      // Note: We no longer block initialization based on state.
      // The 'mode' parameter still determines whether to create a new config file or overwrite.
      if (typeof filename !== 'string' || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'INVALID_FILENAME' });
      }

      let targetFilename = defaultConfigFilename;
      if (mode === 'add') {
        // Duplication Check
        if (typeof serialPath === 'string') {
          const validation = await checkDuplicateSerial(serialPath.trim(), portId?.trim());
          if (validation) {
            return res.status(400).json({ error: validation.error });
          }
        }

        targetFilename = await getNextConfigFilename();
      }

      const targetPath = path.join(configDir, targetFilename);

      let updatedYaml = '';
      let serialPathValue = '';

      if (filename === EMPTY_CONFIG_SENTINEL) {
        const parsed = parseSerialConfigPayload(serialConfig);
        if (!parsed.serialConfig) {
          return res.status(400).json({ error: parsed.error });
        }

        serialPathValue = parsed.serialConfig.path;
        const emptyConfig = buildEmptyConfig(parsed.serialConfig, packetDefaults);
        updatedYaml = dumpConfigToYaml(emptyConfig, { lineWidth: 120 });
      } else {
        if (typeof serialPath !== 'string' || !serialPath.trim()) {
          return res.status(400).json({ error: 'SERIAL_PATH_REQUIRED' });
        }

        const examples = await listExampleConfigs();
        if (!examples.includes(filename)) {
          return res.status(404).json({ error: 'EXAMPLE_NOT_FOUND' });
        }

        const sourcePath = path.join(examplesDir, filename);
        serialPathValue = serialPath.trim();
        const portIdValue = typeof portId === 'string' ? portId.trim() : undefined;

        let parsedConfig: unknown;
        try {
          const rawContent = await fs.readFile(sourcePath, 'utf-8');
          parsedConfig = yaml.load(rawContent);
          // Normalize to ensure IDs are generated for matching
          try {
            normalizeConfig(parsedConfig as HomenetBridgeConfig);
          } catch (e) {
            // Ignore errors
          }
        } catch (error) {
          logger.error({ err: error, sourcePath }, '[service] Failed to read example config');
          return res.status(500).json({ error: 'EXAMPLE_READ_FAILED' });
        }

        if (!applySerialPathToConfig(parsedConfig, serialPathValue, portIdValue, packetDefaults)) {
          return res.status(400).json({ error: 'SERIAL_CONFIG_MISSING' });
        }

        // Filter entities if selectedEntities is provided
        if (selectedEntities && typeof selectedEntities === 'object') {
          const bridgeConfig =
            (parsedConfig as any).homenet_bridge ||
            (parsedConfig as any).homenetBridge ||
            parsedConfig;

          if (bridgeConfig && typeof bridgeConfig === 'object') {
            for (const type of ENTITY_TYPE_KEYS) {
              if (type in selectedEntities) {
                const allowedIds = new Set(selectedEntities[type] || []);
                const items = bridgeConfig[type];
                if (Array.isArray(items)) {
                  const filtered = items.filter((item: any) => allowedIds.has(item.id));
                  if (filtered.length > 0) {
                    bridgeConfig[type] = filtered;
                  } else {
                    delete bridgeConfig[type];
                  }
                }
              }
            }
          }
        }

        updatedYaml = dumpConfigToYaml(parsedConfig, { lineWidth: 120 });
      }

      await fs.mkdir(configDir, { recursive: true });

      if (mode !== 'add' && (await fileExists(targetPath))) {
        try {
          const existingContent = await fs.readFile(targetPath, 'utf-8');
          const existingConfig = yaml.load(existingContent);
          if (existingConfig && typeof existingConfig === 'object') {
            const backupPath = await saveBackup(targetPath, existingConfig, 'init_overwrite');
            logger.info(`[service] Backed up existing config to ${path.basename(backupPath)}`);
          }
        } catch (err) {
          logger.warn({ err }, '[service] Failed to backup existing config during init');
        }
      }

      await fs.writeFile(targetPath, updatedYaml, 'utf-8');
      await fs.writeFile(configRestartFlag, 'restart', 'utf-8');

      logger.info(
        { filename, targetPath, serialPath: serialPathValue },
        '[service] Default config seeded from setup wizard',
      );

      res.json({
        ok: true,
        target: targetFilename,
        restartScheduled: true,
        requiresManualConfigUpdate: envConfigFilesSource !== 'default',
      });
    } catch (error) {
      logger.error({ err: error }, '[service] Failed to select example config');
      res.status(500).json({ error: '설정 적용에 실패했습니다.' });
    }
  });

  return router;
}
