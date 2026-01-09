/**
 * System routes - restart, health check, latency test, settings, and info endpoints
 */

import { Router } from 'express';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { logger, normalizePortId, HomenetBridgeConfig } from '@rs485-homenet/core';
import { triggerRestart, maskMqttPassword, fileExists, normalizeFrontendSettings } from '../utils/helpers.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import type { BridgeInstance, BridgeStatus, ConfigStatus } from '../types/index.js';
import { CONFIG_RESTART_FLAG, BASE_MQTT_PREFIX } from '../utils/constants.js';
import { loadFrontendSettings, saveFrontendSettings } from '../services/frontend-settings.service.js';

const __filename = fileURLToPath(import.meta.url);

export interface SystemRoutesContext {
    configRateLimiter: RateLimiter;
    latencyTestRateLimiter: RateLimiter;
    getBridges: () => BridgeInstance[];
    // Bridge Info Context
    getCurrentConfigs: () => HomenetBridgeConfig[];
    getCurrentConfigFiles: () => string[];
    getCurrentConfigErrors: () => (string | null)[];
    getCurrentConfigStatuses: () => ConfigStatus[];
    getBridgeStatus: () => BridgeStatus;
    getBridgeError: () => string | null;
    isBridgeStarting: () => boolean;
}

export function createSystemRoutes(ctx: SystemRoutesContext): Router {
    const router = Router();
    const restartTokens = new Set<string>();

    // Helper to execute process restart
    const restartProcess = () => {
        setTimeout(async () => {
            // Dev environment support: touch this file to trigger tsx watch restart
            if (process.env.npm_lifecycle_event === 'dev') {
                logger.info('[service] Dev mode detected. Touching file to trigger restart...');
                try {
                    const now = new Date();
                    await fs.utimes(__filename, now, now);
                } catch (err) {
                    logger.error({ err }, '[service] Failed to touch file for dev restart');
                }
            } else {
                logger.info('[service] Exiting process to trigger restart...');
                process.exit(0);
            }
        }, 500);
    };

    // Health check
    router.get('/api/health', (_req, res) => {
        res.json({ status: 'ok' });
    });

    // Get restart token
    router.get('/api/system/restart/token', (req, res) => {
        if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
            return res.status(429).json({ error: 'Too many requests' });
        }

        const token = crypto.randomUUID();
        restartTokens.add(token);
        // Token valid for 1 minute
        setTimeout(() => restartTokens.delete(token), 60000);
        res.json({ token });
    });

    // Execute restart
    router.post('/api/system/restart', async (req, res) => {
        try {
            const { token } = req.body;

            if (!token || !restartTokens.has(token)) {
                logger.warn('[service] Invalid or expired restart token used');
                return res
                    .status(403)
                    .json({ error: 'Invalid or expired token. Please refresh the page and try again.' });
            }

            // Valid token, consume it
            restartTokens.delete(token);

            await triggerRestart();
            res.json({ success: true, message: 'Restarting...' });

            // Trigger process restart
            restartProcess();
        } catch (error) {
            logger.error({ err: error }, '[service] Failed to trigger restart');
            res.status(500).json({ error: 'Restart failed' });
        }
    });

    // Latency test for a specific port
    router.post('/api/bridge/:portId/latency-test', async (req, res) => {
        if (!ctx.latencyTestRateLimiter.check(req.ip || 'unknown')) {
            logger.warn({ ip: req.ip }, '[service] Latency test rate limit exceeded');
            return res.status(429).json({ error: 'Too many requests' });
        }

        const { portId } = req.params;
        const bridges = ctx.getBridges();

        if (bridges.length === 0) {
            return res.status(503).json({ error: 'BRIDGE_NOT_STARTED' });
        }

        // Find the bridge instance managing this port
        let targetBridgeInstance: BridgeInstance | undefined;

        for (const instance of bridges) {
            const serials = instance.config.serials || [];
            for (let i = 0; i < serials.length; i++) {
                const pId = normalizePortId(serials[i].portId, i);
                if (pId === portId) {
                    targetBridgeInstance = instance;
                    break;
                }
            }
            if (targetBridgeInstance) break;
        }

        if (!targetBridgeInstance) {
            return res.status(404).json({ error: 'BRIDGE_NOT_FOUND_FOR_PORT', portId });
        }

        try {
            logger.info({ portId }, '[service] Starting latency test');
            const startTime = Date.now();
            const stats = await targetBridgeInstance.bridge.runLatencyTest(portId);

            const elapsed = Date.now() - startTime;
            if (elapsed < 5000) {
                await new Promise((resolve) => setTimeout(resolve, 5000 - elapsed));
            }

            res.json(stats);
        } catch (error) {
            logger.error({ err: error, portId }, '[service] Latency test failed');
            res.status(500).json({ error: error instanceof Error ? error.message : 'Latency test failed' });
        }
    });

    // --- Bridge Info ---
    router.get('/api/bridge/info', async (_req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        // If a startup is in progress, tell the client to wait.
        if (ctx.isBridgeStarting()) {
            return res.status(503).json({ error: 'BRIDGE_STARTING' });
        }

        const currentConfigFiles = ctx.getCurrentConfigFiles();
        const currentConfigs = ctx.getCurrentConfigs();
        const currentConfigErrors = ctx.getCurrentConfigErrors();
        const currentConfigStatuses = ctx.getCurrentConfigStatuses();
        const bridgeError = ctx.getBridgeError();
        const bridgeStatus = ctx.getBridgeStatus();

        // Return info even when no configs loaded successfully (to show errors)
        if (currentConfigFiles.length === 0) {
            return res.json({
                configFiles: [],
                bridges: [],
                mqttUrl: maskMqttPassword(process.env.MQTT_URL?.trim() || 'mqtt://mq:1883'),
                status: 'error',
                error: bridgeError || 'BRIDGE_NOT_CONFIGURED',
                topic: `${BASE_MQTT_PREFIX}/homedevice1/raw`,
            });
        }

        const bridgesInfo = currentConfigFiles.map((configFile, configIndex) => {
            const config = currentConfigs[configIndex];
            const configError = currentConfigErrors[configIndex];
            const configStatus = currentConfigStatuses[configIndex] || 'idle';

            // Handle case where config failed to load (empty object or null)
            if (configError || !config || !config.serials) {
                return {
                    configFile,
                    serials: [],
                    mqttTopicPrefix: BASE_MQTT_PREFIX,
                    topic: `${BASE_MQTT_PREFIX}/homedevice1/raw`,
                    error: configError || 'Config not loaded',
                    status: configStatus,
                };
            }

            const serialTopics =
                config.serials?.map((serial: HomenetBridgeConfig['serials'][number], index: number) => {
                    const portId = normalizePortId(serial.portId, index);
                    return {
                        portId,
                        path: serial.path,
                        baudRate: serial.baud_rate,
                        topic: `${BASE_MQTT_PREFIX}/${portId}`,
                    };
                }) ?? [];

            return {
                configFile,
                serials: serialTopics,
                mqttTopicPrefix: BASE_MQTT_PREFIX,
                topic: `${serialTopics[0]?.topic || `${BASE_MQTT_PREFIX}/homedevice1`}/raw`,
                error: configError || undefined,
                status: configStatus,
            };
        });

        const firstTopic = bridgesInfo[0]?.topic ?? `${BASE_MQTT_PREFIX}/homedevice1/raw`;

        // .restart-required 파일 존재 여부 확인
        const restartRequired = await fileExists(CONFIG_RESTART_FLAG);

        res.json({
            configFiles: currentConfigFiles,
            bridges: bridgesInfo,
            mqttUrl: maskMqttPassword(process.env.MQTT_URL?.trim() || 'mqtt://mq:1883'),
            status: bridgeStatus,
            error: bridgeError,
            topic: firstTopic,
            restartRequired,
        });
    });

    // --- Frontend Settings ---
    router.get('/api/frontend-settings', async (_req, res) => {
        try {
            const settings = await loadFrontendSettings();
            res.json({ settings });
        } catch (error) {
            logger.error({ err: error }, '[service] Failed to load frontend settings');
            res.status(500).json({ error: '프론트 설정을 불러오지 못했습니다.' });
        }
    });

    router.put('/api/frontend-settings', async (req, res) => {
        if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
            return res.status(429).json({ error: 'Too many requests' });
        }

        try {
            const payload = normalizeFrontendSettings(req.body?.settings ?? req.body);
            await saveFrontendSettings(payload);
            res.json({ settings: payload });
        } catch (error) {
            logger.error({ err: error }, '[service] Failed to save frontend settings');
            res.status(500).json({ error: '프론트 설정을 저장하지 못했습니다.' });
        }
    });

    // --- MQTT Cleanup ---
    router.post('/api/mqtt/cleanup', async (req, res) => {
        if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
            return res.status(429).json({ error: 'Too many requests' });
        }

        // We need at least one active bridge to access the MQTT client
        const activeBridge = ctx.getBridges().find((b) => b.bridge);

        if (!activeBridge) {
            return res.status(503).json({
                error:
                    'No active bridge found to perform MQTT cleanup. Please ensure at least one bridge is configured and running.',
            });
        }

        try {
            logger.info('[service] Starting MQTT retained message cleanup via API');
            const count = await activeBridge.bridge.clearRetainedMessages();
            res.json({ success: true, count, message: `Cleared ${count} retained messages` });

            // Trigger a restart to refresh discovery if messages were cleared
            if (count > 0) {
                await triggerRestart();
                restartProcess();
            }
        } catch (error) {
            logger.error({ err: error }, '[service] Failed to clear retained messages');
            res.status(500).json({ error: 'Failed to clear retained messages' });
        }
    });

    return router;
}
