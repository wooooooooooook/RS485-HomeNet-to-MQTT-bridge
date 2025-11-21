import { describe, it, expect } from 'vitest';
import { parseDuration } from '../src/utils/duration.js';

describe('Duration Parsing', () => {
    it('should parse milliseconds', () => {
        expect(parseDuration('10ms')).toBe(10);
        expect(parseDuration('100ms')).toBe(100);
        expect(parseDuration('1000ms')).toBe(1000);
    });

    it('should parse seconds', () => {
        expect(parseDuration('1s')).toBe(1000);
        expect(parseDuration('5s')).toBe(5000);
        expect(parseDuration('0.5s')).toBe(500);
    });

    it('should parse minutes', () => {
        expect(parseDuration('1m')).toBe(60000);
        expect(parseDuration('5m')).toBe(300000);
    });

    it('should parse hours', () => {
        expect(parseDuration('1h')).toBe(3600000);
    });

    it('should handle numbers directly', () => {
        expect(parseDuration(10)).toBe(10);
        expect(parseDuration(1000)).toBe(1000);
    });

    it('should handle undefined', () => {
        expect(parseDuration(undefined)).toBeUndefined();
    });

    it('should default to ms when no unit specified', () => {
        expect(parseDuration('10')).toBe(10);
        expect(parseDuration('100')).toBe(100);
    });

    it('should throw on invalid format', () => {
        expect(() => parseDuration('invalid')).toThrow();
        expect(() => parseDuration('10x')).toThrow();
    });
});
