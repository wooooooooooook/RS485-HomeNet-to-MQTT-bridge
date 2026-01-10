import path from 'node:path';
import type { Express } from 'express';
import yaml from 'js-yaml';
import { type HomenetBridgeConfig } from '@rs485-homenet/core';

export type ConfigEditorDeps = {
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

export type ConfigEditorService = {
  deps: ConfigEditorDeps;
  isValidConfigFilename: (filename: string) => boolean;
};

export const createConfigEditorService = (deps: ConfigEditorDeps): ConfigEditorService => {
  const { defaultConfigFilename } = deps;

  const isValidConfigFilename = (filename: string): boolean => {
    if (!filename || filename.includes('/') || filename.includes('\\')) {
      return false;
    }
    // Allow default config or .homenet_bridge.yaml/.yml extensions
    return /\.homenet_bridge\.ya?ml$/.test(filename) || filename === defaultConfigFilename;
  };

  return {
    deps,
    isValidConfigFilename,
  };
};
