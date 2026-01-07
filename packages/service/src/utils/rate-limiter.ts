// packages/service/src/utils/rate-limiter.ts

/**
 * Simple in-memory rate limiter to prevent DoS and brute-force attacks.
 * Uses a Fixed Window algorithm.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetTime: number }>();
  private cleanupInterval: NodeJS.Timeout;
  private readonly MAX_TRACKED_IPS = 10000;

  /**
   * @param windowMs Time window in milliseconds
   * @param maxRequests Maximum number of requests allowed per window
   */
  constructor(
    private windowMs: number,
    private maxRequests: number,
  ) {
    // Run cleanup every minute to remove expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
    this.cleanupInterval.unref(); // Allow process to exit
  }

  /**
   * Check if the request from the given IP is allowed.
   * @param ip The IP address of the requester
   * @returns true if allowed, false if limit exceeded
   */
  public check(ip: string): boolean {
    const now = Date.now();
    const record = this.hits.get(ip);

    // If no record or window expired, reset
    if (!record || now > record.resetTime) {
      // Security: Prevent memory exhaustion from unlimited IP tracking (DoS)
      if (!record && this.hits.size >= this.MAX_TRACKED_IPS) {
        // Try to free up space by removing expired entries first
        this.cleanup();

        // If still full, evict the oldest entry (LRU-like behavior via Map insertion order)
        if (this.hits.size >= this.MAX_TRACKED_IPS) {
          const oldestKey = this.hits.keys().next().value;
          if (oldestKey) {
            this.hits.delete(oldestKey);
          }
        }
      }

      this.hits.set(ip, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    // Check limit
    if (record.count >= this.maxRequests) {
      return false;
    }

    // Increment
    record.count++;
    return true;
  }

  /**
   * Remove expired entries to prevent memory leaks.
   */
  private cleanup() {
    const now = Date.now();
    for (const [ip, record] of this.hits.entries()) {
      if (now > record.resetTime) {
        this.hits.delete(ip);
      }
    }
  }

  /**
   * Stop the cleanup interval (useful for testing)
   */
  public destroy() {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Get current number of tracked IPs (for testing)
   */
  public get size(): number {
    return this.hits.size;
  }
}
