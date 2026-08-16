import { describe, it, expect } from 'vitest';
import { makeEntityKey, parseEntityKey } from '../../../src/lib/utils/entity';
import type { EntityCategory } from '../../../src/lib/types';

describe('entity utils', () => {
  describe('makeEntityKey', () => {
    it('creates a key with all parameters provided', () => {
      expect(makeEntityKey('port1', 'entity1', 'entity')).toBe('entity:port1:entity1');
    });

    it('creates a key when portId is undefined', () => {
      expect(makeEntityKey(undefined, 'entity1', 'entity')).toBe('entity:unknown:entity1');
    });

    it('uses default category when category is not provided', () => {
      expect(makeEntityKey('port1', 'entity1')).toBe('entity:port1:entity1');
    });

    it('handles non-default categories', () => {
      expect(makeEntityKey('port1', 'entity1', 'port')).toBe('port:port1:entity1');
    });
  });

  describe('parseEntityKey', () => {
    it('parses a valid key with 3 parts', () => {
      expect(parseEntityKey('entity:port1:entity1')).toEqual({
        category: 'entity',
        portId: 'port1',
        entityId: 'entity1',
      });
    });

    it('parses a key without colons (entityId only)', () => {
      expect(parseEntityKey('entity1')).toEqual({
        category: 'entity',
        portId: undefined,
        entityId: 'entity1',
      });
    });

    it('parses a key with 1 colon (portId:entityId)', () => {
      expect(parseEntityKey('port1:entity1')).toEqual({
        category: 'entity',
        portId: 'port1',
        entityId: 'entity1',
      });
    });

    it('parses a key with 1 colon and unknown portId', () => {
      expect(parseEntityKey('unknown:entity1')).toEqual({
        category: 'entity',
        portId: undefined,
        entityId: 'entity1',
      });
    });

    it('parses a key with 3 parts and unknown portId', () => {
      expect(parseEntityKey('entity:unknown:entity1')).toEqual({
        category: 'entity',
        portId: undefined,
        entityId: 'entity1',
      });
    });

    it('parses a key with more than 2 colons', () => {
      expect(parseEntityKey('entity:port1:entity1:subpart')).toEqual({
        category: 'entity',
        portId: 'port1',
        entityId: 'entity1:subpart',
      });
    });
  });
});
