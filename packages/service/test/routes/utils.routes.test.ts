import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createUtilsRoutes, UtilsRoutesContext } from '../../src/routes/utils.routes.js';
import { RateLimiter } from '../../src/utils/rate-limiter.js';

describe('Utils Routes', () => {
  let app: express.Application;
  let mockRateLimiter: RateLimiter;

  beforeEach(() => {
    mockRateLimiter = {
      check: vi.fn().mockReturnValue(true),
    } as unknown as RateLimiter;

    const ctx: UtilsRoutesContext = {
      configRateLimiter: mockRateLimiter,
    };

    app = express();
    app.use(express.json());
    app.use('/', createUtilsRoutes(ctx));
  });

  it('should execute a valid CEL script', async () => {
    const response = await request(app)
      .post('/api/cel/evaluate')
      .send({
        script: 'data[0] == 1',
        context: {
          data: [1, 2, 3],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ result: true });
  });

  it('should return 400 for empty script', async () => {
    const response = await request(app).post('/api/cel/evaluate').send({
      script: '',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('script must be a non-empty string');
  });

  it('should return 400 for script exceeding max length', async () => {
    const longScript = 'a'.repeat(2049);
    const response = await request(app).post('/api/cel/evaluate').send({
      script: longScript,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Script length exceeds limit');
  });

  it('should return 429 if rate limit exceeded', async () => {
    mockRateLimiter.check = vi.fn().mockReturnValue(false);
    const response = await request(app).post('/api/cel/evaluate').send({
      script: 'true',
    });

    expect(response.status).toBe(429);
  });
});
