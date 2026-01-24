/**
 * Packet tools routes - packet preview and send endpoints
 */

import { Router } from 'express';
import { logger, normalizePortId } from '@rs485-homenet/core';
import type { HomenetBridgeConfig } from '@rs485-homenet/core';
import { analyzePacketChunk } from '@rs485-homenet/core/utils/packet-analysis';
import { RateLimiter } from '../utils/rate-limiter.js';
import type { BridgeInstance } from '../types/index.js';
import type { LogRetentionService } from '../log-retention.service.js';

export interface PacketToolsRoutesContext {
  commandRateLimiter: RateLimiter;
  getBridges: () => BridgeInstance[];
  getCurrentConfigs: () => HomenetBridgeConfig[];
  logRetentionService: LogRetentionService;
}

function findBridgeInstanceByPortId(
  bridges: BridgeInstance[],
  portId: string,
): BridgeInstance | undefined {
  for (const instance of bridges) {
    const serial = instance.config.serial;
    if (!serial) continue;
    const pId = normalizePortId(serial.portId, 0);
    if (pId === portId) {
      return instance;
    }
  }
  return undefined;
}

function findConfigByPortId(
  configs: HomenetBridgeConfig[],
  portId: string | undefined,
): HomenetBridgeConfig | undefined {
  if (!configs || configs.length === 0) return undefined;
  if (!portId) return configs[0];

  for (const [index, config] of configs.entries()) {
    const serial = config.serial;
    if (!serial) continue;
    const pId = normalizePortId(serial.portId, index);
    if (pId === portId) {
      return config;
    }
  }
  return undefined;
}

const parseNumberListInput = (input: string): number[] | null => {
  const trimmed = input.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  const tokens = body.split(',').map((token) => token.trim());
  const values = tokens.map((token) => {
    if (!token) return NaN;
    if (/^0x[0-9a-fA-F]+$/.test(token)) {
      return Number.parseInt(token, 16);
    }
    return Number(token);
  });
  if (values.some((value) => Number.isNaN(value))) {
    return null;
  }
  return values;
};

const parseHexInput = (input: string): number[] | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.includes('0x')) {
    const tokens = trimmed.match(/0x[0-9a-fA-F]+/g);
    if (!tokens) return null;
    const bytes: number[] = [];
    for (const token of tokens) {
      const hex = token.slice(2);
      if (hex.length % 2 !== 0) return null;
      for (let i = 0; i < hex.length; i += 2) {
        const byte = Number.parseInt(hex.slice(i, i + 2), 16);
        bytes.push(byte);
      }
    }
    return bytes;
  }

  const normalized = trimmed.replace(/[^0-9a-fA-F]/g, '');
  if (!normalized || normalized.length % 2 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i += 2) {
    bytes.push(Number.parseInt(normalized.slice(i, i + 2), 16));
  }
  return bytes;
};

const parsePacketInput = (input: unknown): { bytes: number[] } | { error: string } => {
  if (Array.isArray(input)) {
    const bytes = input.map((value) => Number(value));
    if (bytes.some((value) => Number.isNaN(value))) {
      return { error: '입력 배열은 숫자로만 구성되어야 합니다.' };
    }
    if (bytes.some((value) => value < 0 || value > 255)) {
      return { error: '입력 배열 값은 0~255 범위여야 합니다.' };
    }
    return { bytes };
  }

  if (typeof input === 'string') {
    const listParsed = parseNumberListInput(input);
    if (listParsed) {
      if (listParsed.some((value) => value < 0 || value > 255)) {
        return { error: '입력 배열 값은 0~255 범위여야 합니다.' };
      }
      return { bytes: listParsed };
    }

    const hexParsed = parseHexInput(input);
    if (!hexParsed) {
      return { error: '입력값을 Hex 문자열 또는 [int] 배열로 해석할 수 없습니다.' };
    }
    if (hexParsed.some((value) => value < 0 || value > 255)) {
      return { error: 'Hex 입력은 0~255 범위의 바이트여야 합니다.' };
    }
    return { bytes: hexParsed };
  }

  return { error: '입력값은 문자열 또는 숫자 배열이어야 합니다.' };
};

export function createPacketToolsRoutes(ctx: PacketToolsRoutesContext): Router {
  const router = Router();

  // Packet dictionary
  router.get('/api/packets/dictionary', (_req, res) => {
    res.json(ctx.logRetentionService.getPacketDictionary());
  });

  // Command packet history
  router.get('/api/packets/command/history', (_req, res) => {
    res.json({
      dictionary: ctx.logRetentionService.getPacketDictionary(),
      logs: ctx.logRetentionService.getCommandPacketHistoryRaw(),
    });
  });

  // Parsed packet history
  router.get('/api/packets/parsed/history', (_req, res) => {
    res.json({
      dictionary: ctx.logRetentionService.getPacketDictionary(),
      logs: ctx.logRetentionService.getParsedPacketHistoryRaw(),
    });
  });

  // Unmatched (valid but unparsed) packets
  router.get('/api/packets/unmatched', (_req, res) => {
    res.json({
      packets: ctx.logRetentionService.getUnmatchedPackets(),
    });
  });

  // Full dictionary view (dictionary + unmatched packets + stats + parsed entities)
  router.get('/api/packets/dictionary/full', (req, res) => {
    const portId = typeof req.query.portId === 'string' ? req.query.portId : undefined;
    res.json({
      dictionary: ctx.logRetentionService.getPacketDictionary(portId),
      unmatchedPackets: ctx.logRetentionService.getUnmatchedPackets(portId),
      parsedPacketEntities: ctx.logRetentionService.getParsedPacketEntities(portId),
      stats: ctx.logRetentionService.getStats(),
    });
  });

  // Packet preview (construct without sending)
  router.post('/api/tools/packet/preview', async (req, res) => {
    if (!ctx.commandRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Packet preview rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { hex, header, footer, checksum, portId } = req.body;

    if (!hex) return res.status(400).json({ error: 'hex is required' });

    const instance = findBridgeInstanceByPortId(ctx.getBridges(), portId);
    if (!instance) return res.status(404).json({ error: 'Bridge not found' });

    const result = instance.bridge.constructCustomPacket(hex, { header, footer, checksum });
    if (!result.success) return res.status(400).json({ error: result.error });

    res.json({ preview: result.packet });
  });

  // Packet send
  router.post('/api/tools/packet/send', async (req, res) => {
    if (!ctx.commandRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Packet send rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { hex, header, footer, checksum, portId, interval = 100, count = 1 } = req.body;

    if (!hex) return res.status(400).json({ error: 'hex is required' });

    const instance = findBridgeInstanceByPortId(ctx.getBridges(), portId);
    if (!instance) return res.status(404).json({ error: 'Bridge not found' });

    const result = instance.bridge.constructCustomPacket(hex, { header, footer, checksum });
    if (!result.success || !result.packet) return res.status(400).json({ error: result.error });

    const packetBytes = result.packet.match(/.{1,2}/g)?.map((x) => parseInt(x, 16));

    if (!packetBytes) {
      return res.status(400).json({ error: 'Failed to generate packet bytes from hex' });
    }

    const maxCount = 50; // Safety limit
    const effectiveCount = Math.min(count, maxCount);
    let sentCount = 0;

    try {
      for (let i = 0; i < effectiveCount; i++) {
        instance.bridge.sendRawPacket(portId, packetBytes);
        sentCount++;
        if (i < effectiveCount - 1) {
          await new Promise((r) => setTimeout(r, interval));
        }
      }
      res.json({ success: true, sentCount });
    } catch (error) {
      logger.error({ err: error, portId }, '[service] Failed to send custom packet');
      res.status(500).json({ error: 'Failed to send packet' });
    }
  });

  // Packet analyze
  router.post('/api/tools/packet/analyze', (req, res) => {
    if (!ctx.commandRateLimiter.check(req.ip || 'unknown')) {
      logger.warn({ ip: req.ip }, '[service] Packet analyze rate limit exceeded');
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { input, portId } = req.body ?? {};
    const parsed = parsePacketInput(input);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const config = findConfigByPortId(ctx.getCurrentConfigs(), portId);
    if (!config) {
      return res.status(404).json({ error: 'Bridge config not found' });
    }

    try {
      const result = analyzePacketChunk(config, Buffer.from(parsed.bytes));
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, '[service] Packet analyze failed');
      res.status(500).json({ error: 'Packet analyze failed' });
    }
  });

  return router;
}
