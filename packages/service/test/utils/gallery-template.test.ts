import { describe, it, expect } from 'vitest';
import { processGalleryTemplate } from '../../src/utils/gallery-template';

describe('Gallery Template Processor', () => {
  it('should process simple template with parameters', () => {
    const template = {
      parameters: [
        { name: 'light_count', type: 'integer', default: 4 }
      ],
      entities: {
        light: [
          {
            $repeat: {
              count: '{{light_count}}',
              as: 'i',
              start: 1
            },
            id: 'light_{{i}}',
            name: 'Light {{i}}',
            state: {
              data: [176, 0, '{{i}}']
            }
          }
        ]
      }
    };

    const parameters = { light_count: 2 };
    const result = processGalleryTemplate(template, parameters);

    expect(result.entities.light).toHaveLength(2);
    expect(result.entities.light[0]).toEqual({
      id: 'light_1',
      name: 'Light 1',
      state: { data: [176, 0, 1] }
    });
    expect(result.entities.light[1]).toEqual({
      id: 'light_2',
      name: 'Light 2',
      state: { data: [176, 0, 2] }
    });
  });

  it('should use default values if parameters are missing', () => {
    const template = {
      parameters: [
        { name: 'light_count', type: 'integer', default: 2 }
      ],
      entities: {
        light: [
          {
            $repeat: {
              count: '{{light_count}}',
              as: 'i'
            },
            id: 'light_{{i}}'
          }
        ]
      }
    };

    // No parameters provided
    const result = processGalleryTemplate(template, {});
    expect(result.entities.light).toHaveLength(2);
  });

  it('should handle nested loops', () => {
    const template = {
      parameters: [
        { name: 'rooms', type: 'object[]' }
      ],
      entities: {
        light: [
          {
            $repeat: {
              over: 'rooms',
              as: 'room',
              index: 'room_idx'
            },
            $nested: {
              $repeat: {
                count: '{{room.light_count}}',
                as: 'light_num'
              },
              id: 'light_{{room_idx + 1}}_{{light_num}}',
              name: '{{room.name}} Light {{light_num}}'
            }
          }
        ]
      }
    };

    const parameters = {
      rooms: [
        { name: 'Living Room', light_count: 2 },
        { name: 'Bedroom', light_count: 1 }
      ]
    };

    const result = processGalleryTemplate(template, parameters);

    expect(result.entities.light).toHaveLength(3);
    expect(result.entities.light[0].id).toBe('light_1_1');
    expect(result.entities.light[0].name).toBe('Living Room Light 1');
    expect(result.entities.light[1].id).toBe('light_1_2');
    expect(result.entities.light[2].id).toBe('light_2_1');
    expect(result.entities.light[2].name).toBe('Bedroom Light 1');
  });

  it('should support filters (hex, pad)', () => {
    const template = {
      entities: {
        light: [
          {
            id: 'val_{{10 | hex}}',
            name: 'Pad {{1 | pad:3}}'
          }
        ]
      }
    };
    const result = processGalleryTemplate(template, {});
    // Assuming hex returns 0x0A (uppercase)
    // The prompt says {{i | hex}} -> 0x01.
    // Let's implement standard 0xXX format.
    expect(result.entities.light[0].id).toBe('val_0x0A');
    expect(result.entities.light[0].name).toBe('Pad 001');
  });

  it('should support arithmetic expressions', () => {
     const template = {
      entities: {
        light: [
            {
                id: 'val_{{5 + 5}}',
                name: 'Minus {{10 - 2}}'
            }
        ]
      }
    };
    const result = processGalleryTemplate(template, {});
    expect(result.entities.light[0].id).toBe('val_10');
    expect(result.entities.light[0].name).toBe('Minus 8');
  });

  it('should preserve properties not in loops', () => {
      const template = {
        meta: { name: "Test" },
        entities: {
            light: [
                { id: "fixed", name: "Fixed" },
                {
                    $repeat: { count: 1, as: 'i' },
                    id: "dynamic_{{i}}"
                }
            ]
        }
      };
      const result = processGalleryTemplate(template, {});
      expect(result.meta.name).toBe("Test");
      expect(result.entities.light).toHaveLength(2);
      expect(result.entities.light[0].id).toBe("fixed");
      expect(result.entities.light[1].id).toBe("dynamic_1");
  });
});
