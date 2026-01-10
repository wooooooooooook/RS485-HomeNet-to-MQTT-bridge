/**
 * Utils Routes - generic utility endpoints
 */

import { Router } from 'express';
import { logger } from '@rs485-homenet/core';
import { CelExecutor } from '@rs485-homenet/core/protocol/cel-executor';
import { RateLimiter } from '../utils/rate-limiter.js';

export interface UtilsRoutesContext {
  configRateLimiter: RateLimiter;
}

const celExecutor = new CelExecutor();

const parseCelContext = (
  payload: any,
): { context?: Record<string, any>; error?: string; status?: number } => {
  if (!payload || typeof payload !== 'object') {
    return { error: 'body must be object', status: 400 };
  }

  const contextPayload = payload.context ?? {};
  if (contextPayload && typeof contextPayload !== 'object') {
    return { error: 'context must be object', status: 400 };
  }

  const context: Record<string, any> = {};

  if (contextPayload.x !== undefined) {
    const xValue = contextPayload.x;
    if (typeof xValue === 'string') {
      context.x = xValue;
    } else if (typeof xValue === 'number' && Number.isFinite(xValue)) {
      context.x = xValue;
    } else {
      return { error: 'x must be number or string', status: 400 };
    }
  }

  if (contextPayload.data !== undefined) {
    if (!Array.isArray(contextPayload.data)) {
      return { error: 'data must be array', status: 400 };
    }
    const parsedData = contextPayload.data.map((value: unknown) => Number(value));
    if (parsedData.some((value: number) => Number.isNaN(value))) {
      return { error: 'data must be numeric array', status: 400 };
    }
    context.data = parsedData;
  }

  const objectKeys: Array<'state' | 'states' | 'trigger'> = ['state', 'states', 'trigger'];
  for (const key of objectKeys) {
    if (contextPayload[key] !== undefined) {
      const value = contextPayload[key];
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { error: `${key} must be object`, status: 400 };
      }
      context[key] = value;
    }
  }

  return { context };
};

export function createUtilsRoutes(ctx: UtilsRoutesContext): Router {
  const router = Router();

  router.post('/api/cel/evaluate', async (req, res) => {
    if (!ctx.configRateLimiter.check(req.ip || 'unknown')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const script = req.body?.script;
    if (typeof script !== 'string' || script.trim().length === 0) {
      return res.status(400).json({ error: 'script must be a non-empty string' });
    }

    const { context, error, status } = parseCelContext(req.body);
    if (error) {
      return res.status(status ?? 400).json({ error });
    }

    try {
      const { result, error: celError } = celExecutor.executeWithDiagnostics(script, context ?? {});
      if (result === null) {
        return res.json({
          result,
          error: celError ?? 'CEL 평가 실패 또는 null 반환',
        });
      }
      res.json({ result });
    } catch (err) {
      logger.error({ err }, '[service] CEL evaluation failed');
      res.status(500).json({ error: 'CEL 평가 중 오류가 발생했습니다.' });
    }
  });

  return router;
}
