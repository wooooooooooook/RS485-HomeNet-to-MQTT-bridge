import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

/**
 * Global Security Headers Middleware
 * Sets standard security headers for all responses.
 */
export const globalSecurityHeaders = (_req: Request, res: Response, next: NextFunction) => {
  // 보안 헤더 설정
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Referrer 정보 노출 최소화
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Cross-Origin Isolation (Defense in Depth)
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // CSP: 스크립트 및 스타일 인라인 허용 (Svelte 호환), WebSocket 허용
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss: https://raw.githubusercontent.com; object-src 'none'; base-uri 'self'; form-action 'self';",
  );
  // 민감한 브라우저 기능 비활성화
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
};

/**
 * API Security Middleware
 * Disables caching for API endpoints to prevent leakage of sensitive data.
 */
export const apiSecurityHeaders = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
};

/**
 * API Authentication Middleware
 * Enforces token-based authentication if AUTH_TOKEN environment variable is set.
 */
export const apiAuthentication = (req: Request, res: Response, next: NextFunction) => {
  const token = process.env.AUTH_TOKEN?.trim();

  // If no token is configured, skip authentication (open access)
  if (!token) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authentication token' });
  }

  const receivedToken = authHeader.split(' ')[1];

  // Use timingSafeEqual to prevent timing attacks
  const tokenBuffer = Buffer.from(token);
  const receivedBuffer = Buffer.from(receivedToken);

  if (
    tokenBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(tokenBuffer, receivedBuffer)
  ) {
    return res.status(403).json({ error: 'Invalid authentication token' });
  }

  next();
};
