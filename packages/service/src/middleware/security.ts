import type { Request, Response, NextFunction } from 'express';

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
  // CSP: 스크립트 및 스타일 인라인 허용 (Svelte 호환), WebSocket 허용
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss: https://raw.githubusercontent.com; object-src 'none'; base-uri 'self'; form-action 'self';",
  );
  // 민감한 브라우저 기능 비활성화
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Enhanced Security Headers
  // HSTS: 180일간 HTTPS 강제 (서브도메인 포함) - Opt-in via env
  if (process.env.ENABLE_HSTS === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  // XSS Protection: 브라우저 기본 XSS 필터 비활성화 (CSP가 더 강력함, 구형 브라우저 버그 방지)
  res.setHeader('X-XSS-Protection', '0');
  // Origin-Agent-Cluster: 출처 간 격리 강화
  res.setHeader('Origin-Agent-Cluster', '?1');
  // DNS Prefetch Control: DNS 미리 가져오기 제어 (개인정보 보호)
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  // Download Options: IE8 파일 열기 방지
  res.setHeader('X-Download-Options', 'noopen');
  // Cross-Domain Policies: Flash/Adobe 십자 도메인 정책 파일 로드 방지
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

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
