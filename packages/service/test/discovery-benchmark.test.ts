import { describe, it } from 'vitest';
import { evaluateDiscovery, prepareDiscoveryPackets, DiscoverySchema } from '../src/services/discovery.service.js';

describe('Discovery Benchmark', () => {
  it('measures evaluateDiscovery performance', () => {
    const numPackets = 1000;
    const numIterations = 20;

    const packetDict: Record<string, string> = {};
    for (let i = 0; i < numPackets; i++) {
      packetDict[i.toString()] = `B0 ${ (i % 256).toString(16).padStart(2, '0') } 01 02`;
    }

    const schemas: DiscoverySchema[] = [
      {
        match: { regex: 'B0 41 .. 02' },
        dimensions: [{ parameter: 'val', offset: 2 }],
      },
      {
        match: { data: [0xb0, 0x41] },
        dimensions: [{ parameter: 'val', offset: 2 }],
      },
       {
        match: { condition: 'data[0] == 0xb0' },
        dimensions: [{ parameter: 'val', offset: 2 }],
      }
    ];

    const start = performance.now();
    const discoveryPackets = prepareDiscoveryPackets(packetDict, []);
    for (let i = 0; i < numIterations; i++) {
        for (const schema of schemas) {
            evaluateDiscovery(schema, discoveryPackets);
        }
    }
    const end = performance.now();
    console.log(`BENCHMARK_RESULT: ${end - start}ms`);
  });
});
