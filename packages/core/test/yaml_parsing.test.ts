import { describe, it, expect } from 'vitest';
import yaml from 'js-yaml';

describe('YAML Parsing Test', () => {
    it('should parse duration strings', () => {
        const yamlContent = `
packet_defaults:
  rx_timeout: 10ms
  tx_delay: 50ms
  tx_timeout: 500ms
`;

        const parsed = yaml.load(yamlContent) as any;
        console.log('Parsed:', JSON.stringify(parsed, null, 2));
        console.log('rx_timeout type:', typeof parsed.packet_defaults.rx_timeout);
        console.log('rx_timeout value:', parsed.packet_defaults.rx_timeout);

        // js-yaml will parse "10ms" as a string, not a number
        expect(typeof parsed.packet_defaults.rx_timeout).toBe('string');
        expect(parsed.packet_defaults.rx_timeout).toBe('10ms');
    });
});
