import { describe, expect, it } from 'vitest';
import { getSchemaIndex, hasExplicitSchemaIndex } from '../../src/protocol/schema-index.js';

describe('schema-index', () => {
  describe('getSchemaIndex', () => {
    it('returns undefined for null or undefined schema', () => {
      expect(getSchemaIndex(null)).toBeUndefined();
      expect(getSchemaIndex(undefined)).toBeUndefined();
    });

    it('returns the index property if present', () => {
      expect(getSchemaIndex({ index: 0 } as any)).toBe(0);
      expect(getSchemaIndex({ index: 5 } as any)).toBe(5);
    });

    it('returns the offset property if index is missing', () => {
      expect(getSchemaIndex({ offset: 0 } as any)).toBe(0);
      expect(getSchemaIndex({ offset: 10 } as any)).toBe(10);
    });

    it('prioritizes index over offset if both are present', () => {
      expect(getSchemaIndex({ index: 1, offset: 2 } as any)).toBe(1);
      expect(getSchemaIndex({ index: 0, offset: 5 } as any)).toBe(0);
    });

    it('returns undefined if neither index nor offset is present', () => {
      expect(getSchemaIndex({} as any)).toBeUndefined();
      expect(getSchemaIndex({ other: 'prop' } as any)).toBeUndefined();
    });
  });

  describe('hasExplicitSchemaIndex', () => {
    it('returns false for null or undefined schema', () => {
      expect(hasExplicitSchemaIndex(null)).toBe(false);
      expect(hasExplicitSchemaIndex(undefined)).toBe(false);
    });

    it('returns true if schema has an index', () => {
      expect(hasExplicitSchemaIndex({ index: 0 } as any)).toBe(true);
      expect(hasExplicitSchemaIndex({ index: 5 } as any)).toBe(true);
    });

    it('returns true if schema has an offset', () => {
      expect(hasExplicitSchemaIndex({ offset: 0 } as any)).toBe(true);
      expect(hasExplicitSchemaIndex({ offset: 10 } as any)).toBe(true);
    });

    it('returns false if schema has neither', () => {
      expect(hasExplicitSchemaIndex({} as any)).toBe(false);
      expect(hasExplicitSchemaIndex({ other: 'prop' } as any)).toBe(false);
    });
  });
});
