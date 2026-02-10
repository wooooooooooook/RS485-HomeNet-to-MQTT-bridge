import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiAuthentication } from '../src/middleware/security.js';

// Mock process.env
const originalEnv = process.env;

describe('API Authentication Middleware', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };

    // Create a fresh app for each test
    app = express();
    app.use(express.json());
    // Apply the middleware (even if it doesn't exist yet, we'll implement it next)
    app.use('/api', apiAuthentication);
    app.get('/api/test', (req, res) => res.json({ ok: true }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should allow access when AUTH_TOKEN is not set', async () => {
    delete process.env.AUTH_TOKEN;

    const res = await request(app).get('/api/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('should deny access when AUTH_TOKEN is set but Authorization header is missing', async () => {
    process.env.AUTH_TOKEN = 'secret-token';

    const res = await request(app).get('/api/test');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing authentication token' });
  });

  it('should deny access when AUTH_TOKEN is set but Authorization header is invalid format', async () => {
    process.env.AUTH_TOKEN = 'secret-token';

    const res = await request(app)
      .get('/api/test')
      .set('Authorization', 'InvalidFormat secret-token');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or invalid authentication token' });
  });

  it('should deny access when AUTH_TOKEN is set but token is incorrect', async () => {
    process.env.AUTH_TOKEN = 'secret-token';

    const res = await request(app)
      .get('/api/test')
      .set('Authorization', 'Bearer wrong-token');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Invalid authentication token' });
  });

  it('should allow access when AUTH_TOKEN is set and token is correct', async () => {
    process.env.AUTH_TOKEN = 'secret-token';

    const res = await request(app)
      .get('/api/test')
      .set('Authorization', 'Bearer secret-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('should allow access with surrounding whitespace in configured token', async () => {
    process.env.AUTH_TOKEN = '  secret-token  ';

    const res = await request(app)
      .get('/api/test')
      .set('Authorization', 'Bearer secret-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
