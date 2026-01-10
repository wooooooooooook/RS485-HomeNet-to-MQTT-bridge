
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';

// Mock the logger import from core
vi.mock('@rs485-homenet/core', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
  // Add other exports if needed by helpers.ts
}));

// We need to import the function AFTER the mock
// But ESM imports are hoisted. However, vi.mock is also hoisted.
// We can use dynamic import or just rely on hoisting.
import { resolveSecurePath } from '../src/utils/helpers.js';

describe('Path Traversal Prevention', () => {
  const baseDir = path.resolve('/tmp/homenet-test');

  it('should resolve safe paths correctly', () => {
    const filename = 'safe_file.txt';
    const result = resolveSecurePath(baseDir, filename);
    expect(result).toBe(path.join(baseDir, filename));
  });

  it('should resolve nested safe paths correctly', () => {
    const filename = 'subdir/safe_file.txt';
    const result = resolveSecurePath(baseDir, filename);
    expect(result).toBe(path.join(baseDir, 'subdir', 'safe_file.txt'));
  });

  it('should return null for parent directory traversal', () => {
    const filename = '../passwd';
    const result = resolveSecurePath(baseDir, filename);
    expect(result).toBeNull();
  });

  it('should return null for deep parent directory traversal', () => {
    const filename = '../../../../etc/passwd';
    const result = resolveSecurePath(baseDir, filename);
    expect(result).toBeNull();
  });

  it('should return null for absolute paths outside base directory', () => {
    const filename = '/etc/passwd';
    // path.resolve(base, '/etc/passwd') returns '/etc/passwd' on unix
    const result = resolveSecurePath(baseDir, filename);
    expect(result).toBeNull();
  });

  it('should return null for resolving to the base directory itself', () => {
    const filename = '.';
    const result = resolveSecurePath(baseDir, filename);
    expect(result).toBeNull();
  });
});
