import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OccupancySensingServer } from '../../../../src/transports/matter/behaviors/occupancy-sensing-server.js';
import { OccupancySensing } from '@matter/main/clusters';
import { applyPatchState } from '../../../../src/transports/matter/utils/apply-patch-state.js';

vi.mock('../../../../src/transports/matter/utils/apply-patch-state.js', () => ({
  applyPatchState: vi.fn(),
}));

describe('OccupancySensingServer', () => {
  let server: any;

  beforeEach(() => {
    vi.clearAllMocks();
    server = Object.create(OccupancySensingServer.prototype);
    Object.defineProperty(server, 'state', { value: {} });
  });

  const expectOccupied = (isOccupied: boolean) => {
    expect(applyPatchState).toHaveBeenCalledWith(server.state, {
      occupancy: { occupied: isOccupied },
      occupancySensorType: OccupancySensing.OccupancySensorType.PhysicalContact,
      occupancySensorTypeBitmap: {
        pir: false,
        physicalContact: true,
        ultrasonic: false,
      },
    });
  };

  it('should map ON to occupied', () => {
    server.update({ state: 'ON' });
    expectOccupied(true);
  });

  it('should map DETECTED to occupied', () => {
    server.update({ state: 'DETECTED' });
    expectOccupied(true);
  });

  it('should map OCCUPIED to occupied', () => {
    server.update({ state: 'OCCUPIED' });
    expectOccupied(true);
  });

  it('should map true to occupied', () => {
    server.update({ state: true });
    expectOccupied(true);
  });

  it('should map active to occupied', () => {
    server.update({ state: 'active' });
    expectOccupied(true);
  });

  it('should map OFF to not occupied', () => {
    server.update({ state: 'OFF' });
    expectOccupied(false);
  });

  it('should map false to not occupied', () => {
    server.update({ state: false });
    expectOccupied(false);
  });

  it('should map undefined to not occupied', () => {
    server.update(undefined);
    expectOccupied(false);
  });

  it('should map empty state object to not occupied', () => {
    server.update({});
    expectOccupied(false);
  });
});
