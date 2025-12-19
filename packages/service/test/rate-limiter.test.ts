import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    // 5 requests per 1000ms
    limiter = new RateLimiter(1000, 5);
  });

  afterEach(() => {
    limiter.destroy();
    vi.useRealTimers();
  });

  it('should allow requests within limit', () => {
    const ip = '127.0.0.1';
    for (let i = 0; i < 5; i++) {
      expect(limiter.check(ip)).toBe(true);
    }
  });

  it('should block requests exceeding limit', () => {
    const ip = '127.0.0.1';
    for (let i = 0; i < 5; i++) {
      limiter.check(ip);
    }
    expect(limiter.check(ip)).toBe(false);
  });

  it('should reset limit after window', () => {
    const ip = '127.0.0.1';
    for (let i = 0; i < 5; i++) {
      limiter.check(ip);
    }
    expect(limiter.check(ip)).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(limiter.check(ip)).toBe(true);
  });

  it('should track IPs independently', () => {
    const ip1 = '127.0.0.1';
    const ip2 = '192.168.1.1';

    for (let i = 0; i < 5; i++) {
      limiter.check(ip1);
    }
    expect(limiter.check(ip1)).toBe(false);
    expect(limiter.check(ip2)).toBe(true);
  });
});
