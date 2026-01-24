import { Buffer } from 'buffer';
import type {
  AutomationConfig,
  AutomationTriggerPacket,
  AutomationTriggerState,
  HomenetBridgeConfig,
} from '../config/types.js';
import type { EntityConfig } from '../domain/entities/base.entity.js';
import type { ProtocolConfig } from '../protocol/types.js';
import { PacketParser } from '../protocol/packet-parser.js';
import { GenericDevice } from '../protocol/devices/generic.device.js';
import { LightDevice } from '../protocol/devices/light.device.js';
import { ClimateDevice } from '../protocol/devices/climate.device.js';
import { FanDevice } from '../protocol/devices/fan.device.js';
import { ValveDevice } from '../protocol/devices/valve.device.js';
import { ButtonDevice } from '../protocol/devices/button.device.js';
import { SensorDevice } from '../protocol/devices/sensor.device.js';
import { SwitchDevice } from '../protocol/devices/switch.device.js';
import { LockDevice } from '../protocol/devices/lock.device.js';
import { NumberDevice } from '../protocol/devices/number.device.js';
import { SelectDevice } from '../protocol/devices/select.device.js';
import { TextSensorDevice } from '../protocol/devices/text-sensor.device.js';
import { TextDevice } from '../protocol/devices/text.device.js';
import { BinarySensorDevice } from '../protocol/devices/binary-sensor.device.js';
import { slugify } from './common.js';
import { matchesPacket } from './packet-matching.js';
import { logger } from './logger.js';
import type { Device } from '../protocol/device.js';

type EntityMeta = {
  id: string;
  name: string;
  type: string;
};

export type PacketAnalysisEntityMatch = {
  entityId: string;
  entityName: string;
  entityType: string;
  state: Record<string, any>;
};

export type PacketAnalysisPacket = {
  hex: string;
  bytes: number[];
  matches: PacketAnalysisEntityMatch[];
};

export type PacketAnalysisUnmatchedPacket = {
  hex: string;
  bytes: number[];
};

export type PacketAnalysisAutomationMatch = {
  automationId: string;
  name?: string;
  description?: string;
  triggerType: 'packet' | 'state';
  triggerIndex: number;
  packetIndex: number;
  packetHex: string;
  entityId?: string;
  property?: string;
  matchedValue?: unknown;
};

export type PacketAnalysisResult = {
  packets: PacketAnalysisPacket[];
  unmatchedPackets: PacketAnalysisUnmatchedPacket[];
  automationMatches: PacketAnalysisAutomationMatch[];
  errors: string[];
};

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

const entityTypes: Array<keyof HomenetBridgeConfig> = [
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

const buildDevices = (config: HomenetBridgeConfig) => {
  const protocolConfig: ProtocolConfig = {
    packet_defaults: config.packet_defaults,
    rx_priority: 'data',
  };

  const devices: Device[] = [];
  const entityMeta = new Map<string, EntityMeta>();

  for (const type of entityTypes) {
    const entities = config[type] as EntityConfig[] | undefined;
    if (!entities) continue;
    for (const entity of entities) {
      if (!entity.id && entity.name) {
        entity.id = slugify(entity.name);
        logger.debug(`[PacketAnalyzer] Generated ID for ${type}: ${entity.name} -> ${entity.id}`);
      }
      const DeviceClass = deviceMap[type] ?? GenericDevice;
      const device = new DeviceClass(entity, protocolConfig);
      devices.push(device);
      if (entity.id) {
        entityMeta.set(entity.id, {
          id: entity.id,
          name: entity.name ?? entity.id,
          type: type.toString(),
        });
      }
    }
  }

  return { devices, entityMeta, protocolConfig };
};

const matchesValue = (value: any, expected: any) => {
  if (expected === undefined) return true;
  if (expected instanceof RegExp) return expected.test(String(value));
  if (typeof expected === 'string' && expected.startsWith('/') && expected.endsWith('/')) {
    const body = expected.slice(1, -1);
    return new RegExp(body).test(String(value));
  }
  if (expected && typeof expected === 'object') {
    if ('eq' in expected) return value === expected.eq;
    if ('gt' in expected) return value > expected.gt;
    if ('gte' in expected) return value >= expected.gte;
    if ('lt' in expected) return value < expected.lt;
    if ('lte' in expected) return value <= expected.lte;
  }
  return value === expected;
};

const matchesStateTrigger = (trigger: AutomationTriggerState, state: Record<string, any>) => {
  const value = trigger.property ? state[trigger.property] : state;
  return matchesValue(value, trigger.match);
};

const matchesPacketTrigger = (
  trigger: AutomationTriggerPacket,
  packet: Buffer,
  headerLen: number,
) => {
  const match = trigger.match as any;
  const baseOffset = match?.offset === undefined ? headerLen : 0;
  return matchesPacket(match, packet, { baseOffset });
};

export const analyzePacketChunk = (
  config: HomenetBridgeConfig,
  chunk: Buffer,
): PacketAnalysisResult => {
  const { devices, entityMeta } = buildDevices(config);
  const parser = new PacketParser(config.packet_defaults || {});
  const packets = parser.parseChunk(chunk);

  const automationList = (config.automation || []).filter(
    (automation) => automation.enabled !== false,
  );

  const result: PacketAnalysisResult = {
    packets: [],
    unmatchedPackets: [],
    automationMatches: [],
    errors: [],
  };

  const headerLen = config.packet_defaults?.rx_header?.length ?? 0;

  packets.forEach((packet, packetIndex) => {
    const matches: PacketAnalysisEntityMatch[] = [];

    for (const device of devices) {
      try {
        const stateUpdates = device.parseData(packet);
        if (!stateUpdates) continue;
        const entityId = device.getId();
        const meta = entityMeta.get(entityId);
        matches.push({
          entityId,
          entityName: meta?.name ?? device.getName() ?? entityId,
          entityType: meta?.type ?? 'unknown',
          state: stateUpdates,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`${device.getId()}: ${message}`);
      }
    }

    const packetHex = packet.toString('hex').toUpperCase();
    const packetBytes = Array.from(packet);

    if (matches.length === 0) {
      result.unmatchedPackets.push({ hex: packetHex, bytes: packetBytes });
    } else {
      result.packets.push({ hex: packetHex, bytes: packetBytes, matches });
    }

    for (const automation of automationList) {
      automation.trigger.forEach((trigger, triggerIndex) => {
        if (trigger.type === 'packet') {
          if (matchesPacketTrigger(trigger, packet, headerLen)) {
            result.automationMatches.push({
              automationId: automation.id,
              name: automation.name,
              description: automation.description,
              triggerType: 'packet',
              triggerIndex,
              packetIndex,
              packetHex,
            });
          }
        }
      });
    }

    for (const match of matches) {
      for (const automation of automationList) {
        automation.trigger.forEach((trigger, triggerIndex) => {
          if (trigger.type !== 'state') return;
          if (trigger.entity_id !== match.entityId) return;
          if (!matchesStateTrigger(trigger, match.state)) return;
          const matchedValue = trigger.property ? match.state[trigger.property] : match.state;
          result.automationMatches.push({
            automationId: automation.id,
            name: automation.name,
            description: automation.description,
            triggerType: 'state',
            triggerIndex,
            packetIndex,
            packetHex,
            entityId: match.entityId,
            property: trigger.property,
            matchedValue,
          });
        });
      }
    }
  });

  return result;
};
