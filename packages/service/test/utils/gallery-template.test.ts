
import { describe, it, expect } from 'vitest';
import { expandGalleryTemplate } from '../../src/utils/gallery-template';

describe('Security Check', () => {
  it('should not allow accessing global process object', () => {
    const maliciousSnippet = {
      entities: {
        light: [
          {
            id: 'test',
            name: '{{ process.cwd() }}'
          }
        ]
      }
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
      parameters: [
        { name: 'num', type: 'integer', default: 10 }
      ],
      entities: {
        light: [
          {
             id: 'test',
             name: '{{ num * 2 }}'
          }
        ]
      }
    };
    const result = expandGalleryTemplate(snippet as any, { num: 5 });
    // result comes back as a number if the whole string was a template expression and evaluated to a number
    expect((result.entities as any).light[0].name).toBe(10);
  });
});
