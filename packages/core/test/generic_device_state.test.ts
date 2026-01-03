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
        state_value: 'data[1] == 0x01 ? state[\"value\"] : \"\"',
      } as DeviceConfig & { state_value: string },
      protocolConfig,
    );

    (device as unknown as { state: Record<string, any> }).state = { value: 55 };

    const updates = device.parseData(Buffer.from([0x10, 0x01]));

    expect(updates).toEqual({ value: 55 });
  });

  it('should treat missing state fields as null in CEL', () => {
    const protocolConfig: ProtocolConfig = {};
    const deviceConfig: DeviceConfig = {
      id: 'generic_2',
      name: 'Generic Device',
      state: {
        data: [0x10],
      },
    };

    const device = new GenericDevice(
      {
        ...deviceConfig,
        state_value: 'state[\"value\"]',
      } as DeviceConfig & { state_value: string },
      protocolConfig,
    );

    (device as unknown as { state: Record<string, any> }).state = {};

    const updates = device.parseData(Buffer.from([0x10, 0x01]));

    expect(updates).toBeNull();
  });

  it('should support has() for optional state fields in CEL', () => {
    const protocolConfig: ProtocolConfig = {};
    const deviceConfig: DeviceConfig = {
      id: 'generic_3',
      name: 'Generic Device',
      state: {
        data: [0x10],
      },
    };

    const device = new GenericDevice(
      {
        ...deviceConfig,
        state_value: 'has(state.value) && state.value != \"\" ? state.value : \"Unknown\"',
      } as DeviceConfig & { state_value: string },
      protocolConfig,
    );

    (device as unknown as { state: Record<string, any> }).state = {};

    const updates = device.parseData(Buffer.from([0x10, 0x01]));

    expect(updates).toEqual({ value: 'Unknown' });
  });

  it('should reuse previous floor when data[9] is 0x40', () => {
    const protocolConfig: ProtocolConfig = {};
    const deviceConfig: DeviceConfig = {
      id: 'elevator_floor',
      name: 'Elevator Floor',
      state: {
        data: [0x0d],
      },
    };

    const device = new GenericDevice(
      {
        ...deviceConfig,
        state_value:
          'data[9] == 0x40 ? (has(state.value) && state.value != \"\" ? state.value : \"Unknown\") : (data[9] >= 0xB0 ? \"B\" + string(data[9] - 0xB0) : string(data[9]))',
      } as DeviceConfig & { state_value: string },
      protocolConfig,
    );

    const applyUpdates = (updates: Record<string, any> | null) => {
      if (updates) {
        (device as unknown as { updateState: (state: Record<string, any>) => void }).updateState(
          updates,
        );
      }
    };

    const initialUnknown = device.parseData(
      Buffer.from([0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40]),
    );
    expect(initialUnknown).toEqual({ value: 'Unknown' });
    applyUpdates(initialUnknown);

    const floorUpdate = device.parseData(
      Buffer.from([0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02]),
    );
    expect(floorUpdate).toEqual({ value: '2' });
    applyUpdates(floorUpdate);

    const keepPrevious = device.parseData(
      Buffer.from([0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40]),
    );
    expect(keepPrevious).toEqual({ value: '2' });
    applyUpdates(keepPrevious);

    const basementUpdate = device.parseData(
      Buffer.from([0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xb1]),
    );
    expect(basementUpdate).toEqual({ value: 'B1' });
  });
});
