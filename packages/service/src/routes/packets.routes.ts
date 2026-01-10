/**
 * Packet tools routes - packet preview and send endpoints
 */

import { Router } from 'express';
import { logger, normalizePortId } from '@rs485-homenet/core';
import { RateLimiter } from '../utils/rate-limiter.js';
import type { BridgeInstance } from '../types/index.js';
import type { LogRetentionService } from '../log-retention.service.js';

export interface PacketToolsRoutesContext {
  commandRateLimiter: RateLimiter;
  getBridges: () => BridgeInstance[];
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

  return router;
}
