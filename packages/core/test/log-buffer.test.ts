import { describe, it, expect } from 'vitest';
import { LogBuffer } from '../src/utils/log-buffer.js';

describe('LogBuffer', () => {
  it('should initialize with default maxSize', () => {
    const logBuffer = new LogBuffer();
    // Default size is 1000
    for (let i = 0; i < 1005; i++) {
      logBuffer.add('info', [`log ${i}`]);
    }
    const logs = logBuffer.getLogs();
    expect(logs.length).toBe(1000);
    // Should contain the latest logs (index 5 to 1004)
    expect(logs[0].args[0]).toBe('log 5');
    expect(logs[999].args[0]).toBe('log 1004');
  });

  it('should add logs correctly', () => {
    const logBuffer = new LogBuffer(10);
    const now = Date.now();
    logBuffer.add('info', ['test message']);

    const logs = logBuffer.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe('info');
    expect(logs[0].args).toEqual(['test message']);
    expect(logs[0].timestamp).toBeGreaterThanOrEqual(now);
  });

  it('should respect custom maxSize', () => {
    const maxSize = 5;
    const logBuffer = new LogBuffer(maxSize);

    for (let i = 0; i < 10; i++) {
      logBuffer.add('info', [`log ${i}`]);
    }

    const logs = logBuffer.getLogs();
    expect(logs.length).toBe(maxSize);
    // Should contain only the last 5 logs (5, 6, 7, 8, 9)
    expect(logs[0].args[0]).toBe('log 5');
    expect(logs[4].args[0]).toBe('log 9');
  });

  it('should clear logs', () => {
    const logBuffer = new LogBuffer(10);
    logBuffer.add('info', ['test']);
    expect(logBuffer.getLogs().length).toBe(1);

    logBuffer.clear();
    expect(logBuffer.getLogs().length).toBe(0);
  });

  it('should return a copy of the buffer', () => {
    const logBuffer = new LogBuffer(10);
    logBuffer.add('info', ['test']);

    const logs = logBuffer.getLogs();
    logs.push({ timestamp: 0, level: 'fake', args: [] });

    expect(logBuffer.getLogs().length).toBe(1);
  });
});
