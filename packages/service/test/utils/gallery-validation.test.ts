import { describe, expect, it } from 'vitest';
import { validateGalleryEntityIds } from '../../src/utils/gallery-validation.js';

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
