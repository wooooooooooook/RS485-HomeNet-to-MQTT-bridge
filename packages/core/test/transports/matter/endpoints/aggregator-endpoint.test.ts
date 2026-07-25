import { describe, it, expect } from 'vitest';
import { AggregatorEndpoint } from '../../../../src/transports/matter/endpoints/aggregator-endpoint.js';
import { AggregatorEndpoint as AggregatorEndpointType } from '@matter/main/endpoints';

describe('AggregatorEndpoint', () => {
  it('should instantiate correctly with the given id', () => {
    const id = 'test-aggregator-id';
    const endpoint = new AggregatorEndpoint(id);

    expect(endpoint).toBeDefined();
    expect(endpoint.id).toBe(id);
    expect(endpoint.type).toBe(AggregatorEndpointType);
  });
});
