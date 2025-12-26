import { describe, expect, it } from 'vitest';
import { GenericDevice } from '../src/protocol/devices/generic.device.js';
import { DeviceConfig, ProtocolConfig } from '../src/protocol/types.js';

describe('GenericDevice', () => {
  it('should allow state_value CEL to access state.value', () => {
    const protocolConfig: ProtocolConfig = {};
    const deviceConfig: DeviceConfig = {
      id: 'generic_1',
      name: 'Generic Device',
      state: {
        data: [0x10],
      },
    };

    const device = new GenericDevice(
      {
        ...deviceConfig,
        state_value: 'data[1] == 0x01 ? state.value : ""',
      } as DeviceConfig & { state_value: string },
      protocolConfig,
    );

    (device as unknown as { state: Record<string, any> }).state = { value: 55 };

    const updates = device.parseData([0x10, 0x01]);

    expect(updates).toEqual({ value: 55 });
  });
});
