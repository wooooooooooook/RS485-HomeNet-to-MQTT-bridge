
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

  it('should allow helper functions', () => {
     const snippet = {
       parameters: [
         { name: 'val', type: 'integer', default: 18 } // 18 is 0x12
       ],
       entities: {
         light: [
           {
              id: 'test',
              name: '{{ int_to_bcd(val) }}'
           },
           {
              id: 'test2',
              name: '{{ bitAnd(val, 1) }}' // 18 & 1 = 0
           }
         ]
       }
     };
     const result = expandGalleryTemplate(snippet as any, {});
     // 18 in BCD is 0x12 = 18 decimal? No wait.
     // int_to_bcd(18): 18 / 10 = 1, 18 % 10 = 8.
     // (1 << 4) | 8 = 16 | 8 = 24. (0x18).

     // Wait, 12 decimal is 0x0C.
     // 18 decimal is 0x12.
     // BCD of 12 decimal is 0x12 (18).
     // BCD of 18 decimal is 0x18 (24).

     // Let's recheck logic:
     // const v = Number(val);
     // const res = (Math.floor(v / 10) % 10 << 4) | v % 10;
     // Input 18:
     // Math.floor(18/10) = 1. 1 % 10 = 1. 1 << 4 = 16.
     // 18 % 10 = 8.
     // 16 | 8 = 24.
     // So result should be 24.

     expect((result.entities as any).light[0].name).toBe(24);
     expect((result.entities as any).light[1].name).toBe(0);
  });

  it('should allow pipe filters', () => {
     const snippet = {
       parameters: [
         { name: 'val', type: 'integer', default: 10 }
       ],
       entities: {
         light: [
           {
              id: 'test',
              name: '{{ val | pad:3 }}'
           }
         ]
       }
     };
     const result = expandGalleryTemplate(snippet as any, {});
     expect((result.entities as any).light[0].name).toBe('010');
  });
});
