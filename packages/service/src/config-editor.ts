import type { Express } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

type ConfigEditorDeps = {
  configDir: string;
  defaultConfigFilename: string;
  configRestartFlag: string;
  fileExists: (targetPath: string) => Promise<boolean>;
  dumpConfigToYaml: (config: any, options?: yaml.DumpOptions) => string;
  saveBackup: (configPath: string, config: any, reason: string) => Promise<string>;
  triggerRestart: () => Promise<void>;
  configRateLimiter: { check: (key: string) => boolean };
  logger: {
    info: (msg: string | Record<string, unknown>, ...args: unknown[]) => void;
    warn: (msg: string | Record<string, unknown>, ...args: unknown[]) => void;
    error: (msg: string | Record<string, unknown>, ...args: unknown[]) => void;
  };
};

type ConfigEditorService = {
  registerRoutes: (app: Express) => void;
};

export const createConfigEditorService = ({
  configDir,
  defaultConfigFilename,
  configRestartFlag,
  fileExists,
  saveBackup,
  triggerRestart,
  configRateLimiter,
  logger,
}: ConfigEditorDeps): ConfigEditorService => {
  const isValidConfigFilename = (filename: string): boolean => {
    if (!filename || filename.includes('/') || filename.includes('\\')) {
      return false;
    }
    // Allow default config or .homenet_bridge.yaml/.yml extensions
    return /\.homenet_bridge\.ya?ml$/.test(filename) || filename === defaultConfigFilename;
  };

  const registerRoutes = (app: Express) => {
    // GET full config file content
    app.get('/api/config/files/:filename', async (req, res) => {
      try {
        const { filename } = req.params;

        if (!isValidConfigFilename(filename)) {
          return res.status(400).json({ error: 'INVALID_FILENAME' });
        }

        const filePath = path.join(configDir, filename);
        if (!(await fileExists(filePath))) {
          return res.status(404).json({ error: 'FILE_NOT_FOUND' });
        }

        const content = await fs.readFile(filePath, 'utf-8');
        res.json({ content });
      } catch (error) {
        logger.error({ err: error }, '[config-editor] Failed to read config file');
        res.status(500).json({ error: 'READ_FAILED' });
      }
    });

    // PUT full config file content
    app.put('/api/config/files/:filename', async (req, res) => {
      if (!configRateLimiter.check(req.ip || 'unknown')) {
        logger.warn({ ip: req.ip }, '[config-editor] Config update rate limit exceeded');
        return res.status(429).json({ error: 'Too many requests' });
      }

      try {
        const { filename } = req.params;
        const { content, scheduleRestart = false } = req.body as {
          content?: string;
          scheduleRestart?: boolean;
        };

        if (!isValidConfigFilename(filename)) {
          return res.status(400).json({ error: 'INVALID_FILENAME' });
        }

        if (typeof content !== 'string' || !content.trim()) {
          return res.status(400).json({ error: 'CONTENT_REQUIRED' });
        }

        const filePath = path.join(configDir, filename);
        if (!(await fileExists(filePath))) {
          return res.status(404).json({ error: 'FILE_NOT_FOUND' });
        }

        // Validate YAML syntax
        let parsedConfig: unknown;
        try {
          parsedConfig = yaml.load(content);
        } catch (yamlError) {
          const err = yamlError as Error;
          return res.status(400).json({ error: 'INVALID_YAML', details: err.message });
        }

        if (!parsedConfig || typeof parsedConfig !== 'object') {
          return res.status(400).json({ error: 'INVALID_CONFIG_STRUCTURE' });
        }

        // Check for homenet_bridge root key
        const configObj = parsedConfig as Record<string, unknown>;
        if (!configObj.homenet_bridge && !configObj.homenetBridge) {
          return res.status(400).json({ error: 'MISSING_HOMENET_BRIDGE_KEY' });
        }

        // Backup existing config
        try {
          const existingContent = await fs.readFile(filePath, 'utf-8');
          const existingConfig = yaml.load(existingContent);
          if (existingConfig && typeof existingConfig === 'object') {
            await saveBackup(filePath, existingConfig, 'full_edit');
          }
        } catch (backupErr) {
          logger.warn({ err: backupErr }, '[config-editor] Failed to backup config before update');
        }

        // Write new content
        await fs.writeFile(filePath, content, 'utf-8');

        if (scheduleRestart) {
          await fs.writeFile(configRestartFlag, 'restart', 'utf-8');
        }

        logger.info(
          { filename, scheduleRestart },
          '[config-editor] Config file updated via full edit',
        );

        res.json({ success: true, requiresRestart: scheduleRestart });
      } catch (error) {
        logger.error({ err: error }, '[config-editor] Failed to update config file');
        res.status(500).json({ error: 'UPDATE_FAILED' });
      }
    });

    // DELETE config file
    app.delete('/api/config/files/:filename', async (req, res) => {
      if (!configRateLimiter.check(req.ip || 'unknown')) {
        logger.warn({ ip: req.ip }, '[config-editor] Config delete rate limit exceeded');
        return res.status(429).json({ error: 'Too many requests' });
      }

      try {
        const { filename } = req.params;

        if (!isValidConfigFilename(filename)) {
          return res.status(400).json({ error: 'INVALID_FILENAME' });
        }

        const filePath = path.join(configDir, filename);
        if (!(await fileExists(filePath))) {
          return res.status(404).json({ error: 'FILE_NOT_FOUND' });
        }

        // 1. Backup
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const config = yaml.load(content);
          if (config && typeof config === 'object') {
            await saveBackup(filePath, config, 'user_delete');
          }
        } catch (err) {
          logger.warn({ err }, '[config-editor] Failed to backup config before delete');
          // Proceeding anyway as backup failure shouldn't block deletion
        }

        // 2. Delete
        await fs.unlink(filePath);
        logger.info({ filename }, '[config-editor] Config file deleted');

        // 3. Default Bridge Logic - promote next config if default was deleted
        if (filename === defaultConfigFilename) {
          try {
            const files = await fs.readdir(configDir);
            const candidates = files
              .filter((f) => /^default_(\d+)\.homenet_bridge\.yaml$/.test(f))
              .map((f) => {
                const match = f.match(/^default_(\d+)\.homenet_bridge\.yaml$/);
                return { file: f, num: parseInt(match![1], 10) };
              })
              .sort((a, b) => a.num - b.num);

            if (candidates.length > 0) {
              const nextDefault = candidates[0];
              const oldPath = path.join(configDir, nextDefault.file);
              const newPath = path.join(configDir, defaultConfigFilename);
              await fs.rename(oldPath, newPath);
              logger.info(
                { from: nextDefault.file, to: defaultConfigFilename },
                '[config-editor] Promoted new default config',
              );
            }
          } catch (promoteErr) {
            logger.error({ err: promoteErr }, '[config-editor] Failed to promote default config');
          }
        }

        // 4. If this was the last config file, remove .initialized marker
        try {
          const files = await fs.readdir(configDir);
          const remainingConfigs = files.filter(
            (f) => /\.homenet_bridge\.ya?ml$/.test(f) || f === defaultConfigFilename,
          );
          if (remainingConfigs.length === 0) {
            const initMarker = path.join(configDir, '.initialized');
            await fs.unlink(initMarker).catch(() => { });
            logger.info('[config-editor] Last bridge deleted, .initialized marker removed');
          }
        } catch (err) {
          logger.warn({ err }, '[config-editor] Failed to check/remove .initialized marker');
        }

        // 5. Trigger restart
        await fs.writeFile(configRestartFlag, 'restart', 'utf-8');
        await triggerRestart();

        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, '[config-editor] Failed to delete config file');
        res.status(500).json({ error: 'DELETE_FAILED' });
      }
    });
  };

  return {
    registerRoutes,
  };
};
