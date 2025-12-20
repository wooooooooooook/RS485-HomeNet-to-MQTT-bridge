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
import { LockDevice } from './devices/lock.device.js';
import { NumberDevice } from './devices/number.device.js';
import { SelectDevice } from './devices/select.device.js';
import { TextSensorDevice } from './devices/text-sensor.device.js';
import { TextDevice } from './devices/text.device.js';
import { ProtocolConfig } from './types.js';
import { slugify } from '../utils/common.js';
import { CommandGenerator } from './generators/command.generator.js';

export interface EntityStateProvider {
  getLightState(entityId: string): { isOn: boolean } | undefined;
  getClimateState(entityId: string): { targetTemperature: number } | undefined;
  getAllStates(): Record<string, any>;
  getEntityState(entityId: string): any;
}

export class PacketProcessor extends EventEmitter {
  private protocolManager: ProtocolManager;
  private states?: Map<string, Record<string, any>>;
  private commandGenerator: CommandGenerator;

  constructor(
    config: HomenetBridgeConfig,
    stateProvider: EntityStateProvider,
    states?: Map<string, Record<string, any>>,
  ) {
    super();
    this.states = states;
    const protocolConfig: ProtocolConfig = {
      packet_defaults: config.packet_defaults,
      rx_priority: 'data', // Default to data priority
    };
    this.protocolManager = new ProtocolManager(protocolConfig);
    this.commandGenerator = new CommandGenerator(config, stateProvider);

    // Register devices
    const deviceMap: Record<string, any> = {
      light: LightDevice,
      climate: ClimateDevice,
      fan: FanDevice,
      valve: ValveDevice,
      button: ButtonDevice,
      sensor: SensorDevice,
      switch: SwitchDevice,
      lock: LockDevice,
      number: NumberDevice,
      select: SelectDevice,
      text_sensor: TextSensorDevice,
      text: TextDevice,
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
      'lock',
      'number',
      'select',
      'text_sensor',
      'text',
      'binary_sensor',
    ];

    for (const type of entityTypes) {
      const entities = config[type] as EntityConfig[] | undefined;
      if (entities) {
        for (const entity of entities) {
          if (!entity.id && entity.name) {
            entity.id = slugify(entity.name);
            console.debug(
              `[PacketProcessor] Generated ID for ${type}: ${entity.name} -> ${entity.id}`,
            );
          }
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

    this.protocolManager.on('packet', (packet) => {
      this.emit('packet', packet);
    });

    this.protocolManager.on('parsed-packet', (data) => {
      this.emit('parsed-packet', data);
    });
  }

  public processChunk(chunk: Buffer) {
    this.protocolManager.handleIncomingChunk(chunk);
  }

  public constructCommandPacket(
    entity: EntityConfig,
    commandName: string,
    value?: number | string,
  ): number[] | null {
    return this.commandGenerator.constructCommandPacket(entity, commandName, value);
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
