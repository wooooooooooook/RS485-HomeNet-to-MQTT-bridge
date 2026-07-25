import { describe, it, expect } from 'vitest';
import { expandGalleryTemplate } from '../../src/utils/gallery-template';

describe('Security Check', () => {
  it('should not allow accessing global process object', () => {
    const maliciousSnippet = {
      entities: {
        light: [
          {
            id: 'test',
            name: '{{ process.cwd() }}',
          },
        ],
      },
    };

    try {
      const result = expandGalleryTemplate(maliciousSnippet as any, {});
      console.log('Result:', JSON.stringify(result, null, 2));
      throw new Error('Should have failed execution of process.cwd()');
    } catch (e: any) {
      // CEL error message for unknown variable
      expect(e.message).toContain('Unknown variable: process');
    }
  });

  it('should allow benign expressions', () => {
    const snippet = {
      parameters: [{ name: 'num', type: 'integer', default: 10 }],
      entities: {
        light: [
          {
            id: 'test',
            name: '{{ num * 2 }}',
          },
        ],
      },
    };
    const result = expandGalleryTemplate(snippet as any, { num: 5 });
    // result comes back as a number if the whole string was a template expression and evaluated to a number
    expect((result.entities as any).light[0].name).toBe(10);
  });

  it('should allow helper functions', () => {
    const snippet = {
      parameters: [
        { name: 'val', type: 'integer', default: 18 }, // 18 is 0x12
      ],
      entities: {
        light: [
          {
            id: 'test',
            name: '{{ int_to_bcd(val) }}',
          },
          {
            id: 'test2',
            name: '{{ bitAnd(val, 1) }}', // 18 & 1 = 0
          },
        ],
      },
    };
    const result = expandGalleryTemplate(snippet as any, {});

    expect((result.entities as any).light[0].name).toBe(24);
    expect((result.entities as any).light[1].name).toBe(0);
  });

  it('should allow CEL helper functions for formatting', () => {
    const snippet = {
      parameters: [{ name: 'val', type: 'integer', default: 10 }],
      entities: {
        light: [
          {
            id: 'test',
            name: '{{ pad(val, 3) }}',
          },
        ],
      },
    };
    const result = expandGalleryTemplate(snippet as any, {});
    expect((result.entities as any).light[0].name).toBe('010');
  });
});

describe('$if conditional processing', () => {
  it('should include node when $if condition is true', () => {
    const snippet = {
      parameters: [{ name: 'count', type: 'integer', default: 3 }],
      entities: {
        light: [
          {
            $if: '{{ count >= 2 }}',
            id: 'light_2',
            name: 'Light 2',
          },
        ],
      },
    };
    const result = expandGalleryTemplate(snippet as any, { count: 3 });
    expect((result.entities as any).light).toHaveLength(1);
    expect((result.entities as any).light[0].id).toBe('light_2');
  });

  it('should exclude node when $if condition is false', () => {
    const snippet = {
      parameters: [{ name: 'count', type: 'integer', default: 1 }],
      entities: {
        light: [
          {
            $if: '{{ count >= 2 }}',
            id: 'light_2',
            name: 'Light 2',
          },
        ],
      },
    };
    const result = expandGalleryTemplate(snippet as any, { count: 1 });
    expect((result.entities as any).light).toHaveLength(0);
  });

  it('should work with $if inside $repeat', () => {
    const snippet = {
      parameters: [
        {
          name: 'rooms',
          type: 'object[]',
          default: [
            { room_idx: 0, light_count: 2 },
            { room_idx: 1, light_count: 1 },
          ],
        },
      ],
      entities: {
        light: [
          {
            $repeat: { over: 'rooms', as: 'room' },
            $nested: [
              {
                id: 'room_{{ room.room_idx }}_light_1',
                name: 'Light 1',
              },
              {
                $if: '{{ room.light_count >= 2 }}',
                id: 'room_{{ room.room_idx }}_light_2',
                name: 'Light 2',
              },
            ],
          },
        ],
      },
    };
    const result = expandGalleryTemplate(snippet as any, {});
    const lights = (result.entities as any).light;
    // Room 0: light_1, light_2 (count=2)
    // Room 1: light_1 only (count=1)
    expect(lights).toHaveLength(3);
    expect(lights[0].id).toBe('room_0_light_1');
    expect(lights[1].id).toBe('room_0_light_2');
    expect(lights[2].id).toBe('room_1_light_1');
  });
});

describe('Parameter Defaults', () => {
  it('should merge defaults from schema into object[] items', () => {
    const snippet = {
      parameters: [
        {
          name: 'rooms',
          type: 'object[]',
          schema: {
            properties: {
              room_idx: { type: 'integer' },
              light_count: { type: 'integer', default: 2 },
            },
          },
        },
      ],
      entities: {
        light: [
          {
            $repeat: { over: 'rooms', as: 'room' },
            $nested: [
              {
                id: 'room_{{ room.room_idx }}_light_count',
                name: 'Count: {{ room.light_count }}',
              },
            ],
          },
        ],
      },
    };

    // Simulate discovery result where light_count is missing for one item
    const discoveryResult = {
      rooms: [{ room_idx: 0 }, { room_idx: 1, light_count: 3 }],
    };

    const result = expandGalleryTemplate(snippet as any, discoveryResult);
    const lights = (result.entities as any).light;

    expect(lights).toHaveLength(2);
    // Room 0: should use default light_count = 2
    expect(lights[0].name).toBe('Count: 2');
    // Room 1: should use provided light_count = 3
    expect(lights[1].name).toBe('Count: 3');
  });
});
