import { GenericDevice } from './generic.device.js';
import { ProtocolConfig } from '../types.js';
import { BinarySensorEntity } from '../../domain/entities/binary-sensor.entity.js';
import { normalizeDeviceState } from './state-normalizer.js';

export class BinarySensorDevice extends GenericDevice {
  constructor(config: BinarySensorEntity, protocolConfig: ProtocolConfig) {
    super(config, protocolConfig);
  }

  public parseData(packet: Buffer): Record<string, any> | null {
    if (!this.matchesPacket(packet)) {
      return null;
    }

    const updates = super.parseData(packet) || {};
    const headerLength = this.protocolConfig.packet_defaults?.rx_header?.length || 0;
    const payload = packet.slice(headerLength);
    const normalized = normalizeDeviceState(
      { ...this.config, type: 'binary_sensor' } as BinarySensorEntity,
      payload,
      updates,
      {
      headerLen: headerLength,
      state: this.getState(),
      },
    );

    return Object.keys(normalized).length > 0 ? normalized : null;
  }
}
