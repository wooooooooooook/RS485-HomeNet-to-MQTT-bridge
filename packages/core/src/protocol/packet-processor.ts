import { EventEmitter } from 'node:events';
import { Buffer } from 'buffer';
import { HomenetBridgeConfig } from '../config/types.js';
import { EntityConfig } from '../domain/entities/base.entity.js';
import { ProtocolManager } from './protocol-manager.js';
import { GenericDevice } from './devices/generic.device.js';
import { LightDevice } from './devices/light.device.js';
import { ClimateDevice } from './devices/climate.device.js';
import { FanDevice } from './devices/fan.device.js';
import { ValveDevice } from './devices/valve.device.js';
import { ButtonDevice } from './devices/button.device.js';
import { SensorDevice } from './devices/sensor.device.js';
import { SwitchDevice } from './devices/switch.device.js';
import { ProtocolConfig } from './types.js';

export interface EntityStateProvider {
  getLightState(entityId: string): { isOn: boolean } | undefined;
  getClimateState(entityId: string): { targetTemperature: number } | undefined;
}

export class PacketProcessor extends EventEmitter {
  private protocolManager: ProtocolManager;

  constructor(config: HomenetBridgeConfig, stateProvider: EntityStateProvider) {
    super();
    const protocolConfig: ProtocolConfig = {
      packet_defaults: config.packet_defaults,
      rx_priority: 'data' // Default to data priority
    };
    this.protocolManager = new ProtocolManager(protocolConfig);

    // Register devices
    const deviceMap: Record<string, any> = {
      light: LightDevice,
      climate: ClimateDevice,
      fan: FanDevice,
      valve: ValveDevice,
      button: ButtonDevice,
      sensor: SensorDevice,
      switch: SwitchDevice,
      binary_sensor: SensorDevice, // Use SensorDevice for binary_sensor for now
    };

    const entityTypes: (keyof HomenetBridgeConfig)[] = [
      'light',
      'climate',
      'valve',
      'button',
      'sensor',
      'fan',
      'switch',
      'binary_sensor',
    ];

    for (const type of entityTypes) {
      const entities = config[type] as EntityConfig[] | undefined;
      if (entities) {
        for (const entity of entities) {
          const DeviceClass = deviceMap[type] || GenericDevice;
          const device = new DeviceClass(entity, protocolConfig);
          this.protocolManager.registerDevice(device);
        }
      }
    }

    // Listen to state updates
    this.protocolManager.on('state', (event) => {
      this.emit('state', event);
    });
  }

  public processChunk(chunk: Buffer) {
    for (const byte of chunk) {
      this.protocolManager.handleIncomingByte(byte);
    }
  }

  public constructCommandPacket(
    entity: EntityConfig,
    commandName: string,
    value?: number | string,
  ): number[] | null {
    // Find the device in protocol manager?
    // Or just create a temporary device to construct command?
    // Ideally we should look up the registered device.
    // But ProtocolManager doesn't expose getDeviceById yet.
    // For now, let's use a temporary GenericDevice since it's stateless for command construction usually.
    // OR, better, add getDeviceById to ProtocolManager.

    // Using temporary device for now to keep it simple
    const device = new GenericDevice(entity, this.protocolManager['config']);
    return device.constructCommand(commandName, value);
  }

  // Deprecated/Legacy method support if needed, or remove if we update call sites
  public parseIncomingPacket(
    packet: number[],
    allEntities: EntityConfig[],
  ): { parsedStates: { entityId: string; state: any }[]; checksumValid: boolean } {
    // This method is no longer compatible with the stream-based approach.
    // We should update the caller (StateManager) to use processChunk.
    // For now, return empty to avoid breaking if called, but log warning.
    console.warn('PacketProcessor.parseIncomingPacket is deprecated. Use processChunk instead.');
    return { parsedStates: [], checksumValid: true };
  }
}
