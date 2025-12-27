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
import { BinarySensorDevice } from './devices/binary-sensor.device.js';
import { ProtocolConfig } from './types.js';
import { slugify } from '../utils/common.js';
import { logger } from '../utils/logger.js';

export interface EntityStateProvider {
  getLightState(entityId: string): { isOn: boolean } | undefined;
  getClimateState(entityId: string): { targetTemperature: number } | undefined;
  getAllStates(): Record<string, any>;
  getEntityState(entityId: string): any;
}

/**
 * Orchestrates the processing of packets and commands for all registered devices.
 *
 * This class serves as the bridge between the configuration (Entities) and the lower-level
 * protocol management (`ProtocolManager`). Its responsibilities include:
 * 1. Initializing the `ProtocolManager` with packet parsing rules.
 * 2. Registering `Device` instances based on the provided configuration.
 * 3. Routing incoming data chunks to the protocol manager for parsing.
 * 4. Constructing command packets for entities, handling command normalization and device lookup.
 * 5. Managing optimistic state updates for responsive UI feedback.
 */
export class PacketProcessor extends EventEmitter {
  private protocolManager: ProtocolManager;
  private states?: Map<string, Record<string, any>>;

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
      binary_sensor: BinarySensorDevice,
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
            logger.debug(
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

  /**
   * Processes a chunk of incoming raw data.
   * Delegates the data to `ProtocolManager` for buffering, parsing, and state extraction.
   *
   * @param chunk - The raw data buffer received from the serial/network interface.
   */
  public processChunk(chunk: Buffer) {
    this.protocolManager.handleIncomingChunk(chunk);
  }

  /**
   * Constructs a command packet for a specific entity and action.
   *
   * This method:
   * 1. Normalizes the command name (e.g., handles 'command_' prefix).
   * 2. Finds the registered `Device` instance for the entity.
   * 3. Delegates packet construction to the device (which may use CEL or static config).
   * 4. Handles 'optimistic' state updates if configured, emitting a state change event immediately.
   *
   * @param entity - The configuration of the target entity.
   * @param commandNameInput - The name of the command (e.g., 'on', 'command_off').
   * @param value - Optional value for the command (e.g., temperature, brightness).
   * @returns The constructed packet as a number array, or `null` if construction failed.
   */
  public constructCommandPacket(
    entity: EntityConfig,
    commandNameInput: string,
    value?: number | string,
  ): number[] | null {
    const commandName = commandNameInput.startsWith('command_')
      ? commandNameInput.slice('command_'.length)
      : commandNameInput;

    // Try to find the registered device
    let device = this.protocolManager.getDevice(entity.id);

    // If not found, fallback to temporary GenericDevice (legacy behavior)
    if (!device) {
      device = new GenericDevice(entity, this.protocolManager['config']);
    }

    const cmd = device.constructCommand(commandName, value, this.states);

    // Handle Optimistic Updates
    if (entity.optimistic) {
      const optimisticState = device.getOptimisticState(commandName, value);
      if (optimisticState) {
        // Emit state update immediately
        this.emit('state', { deviceId: entity.id, state: optimisticState });
      }

      // If no command packet was generated (virtual switch), return empty array
      // so the caller treats it as "processed" instead of "failed"
      if (!cmd) {
        return [];
      }
    }

    return cmd;
  }

  /**
   * @deprecated This method is legacy and incompatible with the stream-based parsing architecture.
   * Use `processChunk` instead, which handles buffering and parsing via `ProtocolManager`.
   */
  public parseIncomingPacket(
    packet: number[],
    allEntities: EntityConfig[],
  ): { parsedStates: { entityId: string; state: any }[]; checksumValid: boolean } {
    // This method is no longer compatible with the stream-based approach.
    // We should update the caller (StateManager) to use processChunk.
    // For now, return empty to avoid breaking if called, but log warning.
    logger.warn('PacketProcessor.parseIncomingPacket is deprecated. Use processChunk instead.');
    return { parsedStates: [], checksumValid: true };
  }
}
