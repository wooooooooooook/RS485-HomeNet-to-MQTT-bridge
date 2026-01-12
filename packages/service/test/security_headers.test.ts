import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { globalSecurityHeaders, apiSecurityHeaders } from '../src/middleware/security.js';

// Create a minimal express app using the ACTUAL middleware
function createTestApp() {
  const app = express();

  app.disable('x-powered-by');

  // Use the real middleware
  app.use(globalSecurityHeaders);
  app.use('/api', apiSecurityHeaders);

  app.get('/', (_req, res) => res.send('OK'));
  app.get('/api/test', (_req, res) => res.json({ ok: true }));

  return app;
}

describe('Security Headers', () => {
  const app = createTestApp();

  it('should set security headers globally', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toBe('geolocation=(), microphone=(), camera=()');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('should disable x-powered-by', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('should set no-cache headers for API routes', async () => {
    const res = await request(app).get('/api/test');
    expect(res.headers['cache-control']).toBe(
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    );
    expect(res.headers['pragma']).toBe('no-cache');
    expect(res.headers['expires']).toBe('0');
  });

  it('should NOT set no-cache headers for non-API routes', async () => {
    const res = await request(app).get('/');
    expect(res.headers['cache-control']).not.toBe(
      'no-store, no-cache, must-revalidate, proxy-revalidate',
    );
  });
});
