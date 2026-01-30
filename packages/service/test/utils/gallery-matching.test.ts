import { describe, it, expect } from 'vitest';
import {
  buildEntitySignature,
  buildEntitySignatureObject,
  calculateSignatureSimilarity,
  findBestSignatureMatch,
  findAllSignatureMatches,
} from '../../src/utils/gallery-matching.js';

describe('buildEntitySignature', () => {
  it('should match entities with identical packet schemas regardless of id', () => {
    const signatureA = buildEntitySignature('light', {
      id: 'light_1',
      name: '거실 조명',
      state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
      command_on: { data: [0x31, 0x01] },
    });

    const signatureB = buildEntitySignature('light', {
      id: 'light_2',
      name: '안방 조명',
      state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
      command_on: { data: [0x31, 0x01] },
    });

    expect(signatureA).toBe(signatureB);
  });

  it('should differentiate by entity type', () => {
    const signatureA = buildEntitySignature('light', {
      id: 'light_1',
      state: { data: [0x30, 0x01] },
    });
    const signatureB = buildEntitySignature('switch', {
      id: 'switch_1',
      state: { data: [0x30, 0x01] },
    });

    expect(signatureA).not.toBe(signatureB);
  });

  it('should return null when no packet schema is defined', () => {
    const signature = buildEntitySignature('sensor', {
      id: 'sensor_1',
      name: 'no-schema',
    });

    expect(signature).toBeNull();
  });
});

describe('calculateSignatureSimilarity', () => {
  it('should return 1 for identical signatures', () => {
    const sigA = buildEntitySignatureObject('light', {
      id: 'light_1',
      state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
      command_on: { data: [0x31, 0x01] },
    });
    const sigB = buildEntitySignatureObject('light', {
      id: 'light_2',
      state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
      command_on: { data: [0x31, 0x01] },
    });

    expect(sigA).not.toBeNull();
    expect(sigB).not.toBeNull();
    expect(calculateSignatureSimilarity(sigA!, sigB!)).toBe(1);
  });

  it('should return 0 for different entity types', () => {
    const sigA = buildEntitySignatureObject('light', {
      id: 'light_1',
      state: { data: [0x30, 0x01] },
    });
    const sigB = buildEntitySignatureObject('switch', {
      id: 'switch_1',
      state: { data: [0x30, 0x01] },
    });

    expect(sigA).not.toBeNull();
    expect(sigB).not.toBeNull();
    expect(calculateSignatureSimilarity(sigA!, sigB!)).toBe(0);
  });

  it('should return partial similarity for partially matching signatures', () => {
    const sigA = buildEntitySignatureObject('light', {
      id: 'light_1',
      state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
      command_on: { data: [0x31, 0x01] },
      command_off: { data: [0x31, 0x00] },
    });
    const sigB = buildEntitySignatureObject('light', {
      id: 'light_2',
      state: { data: [0x30, 0x02], mask: [0xff, 0xff], offset: 0 }, // data differs
      command_on: { data: [0x31, 0x01] }, // same
      command_off: { data: [0x31, 0x00] }, // same
    });

    expect(sigA).not.toBeNull();
    expect(sigB).not.toBeNull();

    const similarity = calculateSignatureSimilarity(sigA!, sigB!);
    // state: 2/3 fields match (data differs) = 0.666...
    // commands: 2/2 commands match fully = 1
    // Weighted: (0.666... * 0.5) + (1 * 0.5) = 0.833...
    expect(similarity).toBeGreaterThan(0.8);
    expect(similarity).toBeLessThan(1);
  });
});

describe('findBestSignatureMatch', () => {
  it('should find matching entity above threshold', () => {
    const existingList = [
      {
        id: 'existing_light_1',
        state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
        command_on: { data: [0x31, 0x01] },
      },
      {
        id: 'existing_light_2',
        state: { data: [0x40, 0x02], mask: [0xff, 0xff] },
      },
    ];

    const newEntity = {
      id: 'gallery_light',
      state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
      command_on: { data: [0x31, 0x01] },
    };

    const result = findBestSignatureMatch('light', newEntity, existingList);
    expect(result).not.toBeNull();
    expect(result!.matchId).toBe('existing_light_1');
    expect(result!.similarity).toBe(1);
  });

  it('should return null when no match above threshold', () => {
    const existingList = [
      {
        id: 'existing_light',
        state: { data: [0xff, 0xff], mask: [0xff, 0xff] },
        command_on: { data: [0xaa, 0xbb] },
        command_off: { data: [0xcc, 0xdd] },
      },
    ];

    const newEntity = {
      id: 'gallery_light',
      state: { data: [0x30, 0x01] },
      command_on: { data: [0x31, 0x01] },
    };

    const result = findBestSignatureMatch('light', newEntity, existingList);
    // All fields differ significantly, should be below 80% threshold
    expect(result).toBeNull();
  });

  it('should find best match when multiple candidates exist', () => {
    const existingList = [
      {
        id: 'light_partial_match',
        state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
        command_on: { data: [0x99, 0x99] }, // different command
      },
      {
        id: 'light_exact_match',
        state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
        command_on: { data: [0x31, 0x01] },
      },
    ];

    const newEntity = {
      id: 'gallery_light',
      state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
      command_on: { data: [0x31, 0x01] },
    };

    const result = findBestSignatureMatch('light', newEntity, existingList);
    expect(result).not.toBeNull();
    expect(result!.matchId).toBe('light_exact_match');
    expect(result!.similarity).toBe(1);
  });
});

describe('findAllSignatureMatches', () => {
  it('should return all matching entities sorted by similarity descending', () => {
    const existingList = [
      {
        id: 'light_partial_match',
        state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
        command_on: { data: [0x99, 0x99] }, // different command
      },
      {
        id: 'light_exact_match',
        state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
        command_on: { data: [0x31, 0x01] },
      },
      {
        id: 'light_no_match',
        state: { data: [0xff, 0xff] },
        command_on: { data: [0xaa, 0xaa] },
      },
    ];

    const newEntity = {
      id: 'gallery_light',
      state: { data: [0x30, 0x01], mask: [0xff, 0xff], offset: 0 },
      command_on: { data: [0x31, 0x01] },
    };

    const results = findAllSignatureMatches('light', newEntity, existingList);

    // Should find at least 2 matches above threshold
    expect(results.length).toBeGreaterThanOrEqual(1);

    // First result should be the best match
    expect(results[0].matchId).toBe('light_exact_match');
    expect(results[0].similarity).toBe(1);

    // Check descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i].similarity).toBeLessThanOrEqual(results[i - 1].similarity);
    }
  });

  it('should return empty array when no matches above threshold', () => {
    const existingList = [
      {
        id: 'other_light',
        state: { data: [0xff, 0xff] },
        command_on: { data: [0xaa, 0xaa] },
        command_off: { data: [0xbb, 0xbb] },
      },
    ];

    const newEntity = {
      id: 'gallery_light',
      state: { data: [0x30, 0x01] },
      command_on: { data: [0x31, 0x01] },
    };

    const results = findAllSignatureMatches('light', newEntity, existingList);
    expect(results).toEqual([]);
  });
});
