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
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['content-security-policy']).toContain("base-uri 'self'");
    expect(res.headers['content-security-policy']).toContain("form-action 'self'");

    // Enhanced headers
    expect(res.headers['x-xss-protection']).toBe('0');
    expect(res.headers['origin-agent-cluster']).toBe('?1');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['x-download-options']).toBe('noopen');
    expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
  });

  it('should enable HSTS when ENABLE_HSTS is set', async () => {
    process.env.ENABLE_HSTS = 'true';
    const res = await request(app).get('/');
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000; includeSubDomains');
    delete process.env.ENABLE_HSTS;
  });

  it('should NOT enable HSTS by default', async () => {
    delete process.env.ENABLE_HSTS;
    const res = await request(app).get('/');
    expect(res.headers['strict-transport-security']).toBeUndefined();
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
