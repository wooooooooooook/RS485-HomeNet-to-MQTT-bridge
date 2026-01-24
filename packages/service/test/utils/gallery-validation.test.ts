import { describe, expect, it } from 'vitest';
import {
  validateGalleryAutomationIds,
  validateGalleryEntityIds,
  validateGalleryScriptIds,
} from '../../src/utils/gallery-validation.js';

describe('validateGalleryEntityIds', () => {
  it('returns empty list when all entities have ids', () => {
    const missing = validateGalleryEntityIds({
      fan: [
        { id: 'room_1_fan_1', name: 'Room 1 Fan 1' },
        { id: 'room_1_fan_2', name: 'Room 1 Fan 2' },
      ],
    });

    expect(missing).toEqual([]);
  });

  it('returns entries without ids', () => {
    const missing = validateGalleryEntityIds({
      fan: [{ name: 'Room 1 Fan 1' }],
      light: [{ id: 'room_1_light_1' }, null],
    });

    expect(missing).toEqual(['fan[0]', 'light[1]']);
  });

  it('ignores non-array entity lists', () => {
    const missing = validateGalleryEntityIds({
      sensor: { id: 'room_1_sensor_1' },
    });

    expect(missing).toEqual([]);
  });
});

describe('validateGalleryAutomationIds', () => {
  it('returns empty list when automations have ids', () => {
    const missing = validateGalleryAutomationIds([{ id: 'auto_1' }, { id: 'auto_2' }]);

    expect(missing).toEqual([]);
  });

  it('returns entries without ids', () => {
    const missing = validateGalleryAutomationIds([{ id: 'auto_1' }, { name: 'No id' }]);

    expect(missing).toEqual(['automation[1]']);
  });
});

describe('validateGalleryScriptIds', () => {
  it('returns empty list when scripts have ids', () => {
    const missing = validateGalleryScriptIds([{ id: 'script_1' }, { id: 'script_2' }]);

    expect(missing).toEqual([]);
  });

  it('returns entries without ids', () => {
    const missing = validateGalleryScriptIds([{ name: 'No id' }, { id: 'script_2' }]);

    expect(missing).toEqual(['scripts[0]']);
  });
});
