import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateManager } from '../../src/state/state-manager.js';
import { PacketProcessor } from '../../src/protocol/packet-processor.js';
import { HomenetBridgeConfig } from '../../src/config/types.js';
import { eventBus } from '../../src/service/event-bus.js';

const PORT_ID = 'test-port';
const cacheFileName = `states_cache_${PORT_ID}.json`;

describe('Local State Persistence Cache', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homenet-test-'));
    configPath = path.join(tempDir, 'homenet_bridge.yaml');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('should save and load entity states to/from disk', async () => {
    const config: HomenetBridgeConfig = {
      serial: {
        portId: PORT_ID,
        path: '/dev/null',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      light: [{ id: 'light.livingroom', name: 'Living Room Light' }],
    };

    const packetProcessor = new PacketProcessor(config, { getEntityState: () => undefined } as any);
    const stateManager = await StateManager.create(
      PORT_ID,
      config,
      packetProcessor,
      'homenet',
      new Map(),
      undefined,
      configPath,
    );

    // Update state to trigger save states
    stateManager.updateEntityState('light.livingroom', { state: 'ON' });

    // Wait for debounced write (1.5 seconds)
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Verify cache file was created with per-port filename
    const cacheFilePath = path.join(tempDir, cacheFileName);
    expect(fs.existsSync(cacheFilePath)).toBe(true);

    const cacheContent = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
    expect(cacheContent['light.livingroom']).toEqual({ state: 'ON' });

    // Create a new StateManager to load from disk
    const nextStateManager = await StateManager.create(
      PORT_ID,
      config,
      packetProcessor,
      'homenet',
      new Map(),
      undefined,
      configPath,
    );

    const restoredState = nextStateManager.getEntityState('light.livingroom');
    expect(restoredState).toEqual({ state: 'ON' });
  });

  it('should skip orphan entities not present in current config', async () => {
    const config: HomenetBridgeConfig = {
      serial: {
        portId: PORT_ID,
        path: '/dev/null',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      light: [{ id: 'light.livingroom', name: 'Living Room Light' }],
    };

    const packetProcessor = new PacketProcessor(config, { getEntityState: () => undefined } as any);

    // Pre-populate per-port cache file with an orphan entity
    const cacheFilePath = path.join(tempDir, cacheFileName);
    fs.writeFileSync(
      cacheFilePath,
      JSON.stringify({
        'light.livingroom': { state: 'ON' },
        room_0_heater: { state: 'heat', targetTemperature: 24 },
      }),
      'utf8',
    );

    const stateManager = await StateManager.create(
      PORT_ID,
      config,
      packetProcessor,
      'homenet',
      new Map(),
      undefined,
      configPath,
    );

    // Valid entity should be restored
    expect(stateManager.getEntityState('light.livingroom')).toEqual({ state: 'ON' });

    // Orphan entity should NOT be restored
    expect(stateManager.getEntityState('room_0_heater')).toBeUndefined();
  });

  it('should clean orphan entities from cache file on disk', async () => {
    const config: HomenetBridgeConfig = {
      serial: {
        portId: PORT_ID,
        path: '/dev/null',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      switch: [{ id: 'plug_1', name: 'Plug 1' }],
    };

    const packetProcessor = new PacketProcessor(config, { getEntityState: () => undefined } as any);

    // Pre-populate per-port cache file with valid + orphan entities
    const cacheFilePath = path.join(tempDir, cacheFileName);
    fs.writeFileSync(
      cacheFilePath,
      JSON.stringify({
        plug_1: { state: 'OFF' },
        deleted_switch: { state: 'ON' },
        old_sensor: { value: 42 },
      }),
      'utf8',
    );

    // Loading StateManager should filter and rewrite the cache
    await StateManager.create(
      PORT_ID,
      config,
      packetProcessor,
      'homenet',
      new Map(),
      undefined,
      configPath,
    );

    // Cache file should only contain the valid entity
    const cleanedCache = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
    expect(cleanedCache).toEqual({ plug_1: { state: 'OFF' } });
    expect(cleanedCache).not.toHaveProperty('deleted_switch');
    expect(cleanedCache).not.toHaveProperty('old_sensor');
  });

  it('should migrate from legacy shared cache file', async () => {
    const config: HomenetBridgeConfig = {
      serial: {
        portId: PORT_ID,
        path: '/dev/null',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      light: [{ id: 'light.livingroom', name: 'Living Room Light' }],
    };

    const packetProcessor = new PacketProcessor(config, { getEntityState: () => undefined } as any);

    // Create legacy shared cache file (old format)
    const legacyCachePath = path.join(tempDir, 'states_cache.json');
    fs.writeFileSync(
      legacyCachePath,
      JSON.stringify({
        'light.livingroom': { state: 'ON' },
        other_port_entity: { state: 'OFF' },
      }),
      'utf8',
    );

    const stateManager = await StateManager.create(
      PORT_ID,
      config,
      packetProcessor,
      'homenet',
      new Map(),
      undefined,
      configPath,
    );

    // Should restore valid entity from migrated cache
    expect(stateManager.getEntityState('light.livingroom')).toEqual({ state: 'ON' });

    // Orphan should still be filtered
    expect(stateManager.getEntityState('other_port_entity')).toBeUndefined();

    // Per-port cache file should exist
    const perPortCachePath = path.join(tempDir, cacheFileName);
    expect(fs.existsSync(perPortCachePath)).toBe(true);

    // Legacy shared cache file should be deleted
    expect(fs.existsSync(legacyCachePath)).toBe(false);
  });

  it('should isolate cache between different ports', async () => {
    const config1: HomenetBridgeConfig = {
      serial: {
        portId: 'port_a',
        path: '/dev/ttyA',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      light: [{ id: 'light_a', name: 'Light A' }],
    };

    const config2: HomenetBridgeConfig = {
      serial: {
        portId: 'port_b',
        path: '/dev/ttyB',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      switch: [{ id: 'switch_b', name: 'Switch B' }],
    };

    const configPath1 = path.join(tempDir, 'config1.yaml');
    const configPath2 = path.join(tempDir, 'config2.yaml');

    const pp1 = new PacketProcessor(config1, { getEntityState: () => undefined } as any);
    const pp2 = new PacketProcessor(config2, { getEntityState: () => undefined } as any);

    // Pre-populate per-port cache files
    fs.writeFileSync(
      path.join(tempDir, 'states_cache_port_a.json'),
      JSON.stringify({ light_a: { state: 'ON' } }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(tempDir, 'states_cache_port_b.json'),
      JSON.stringify({ switch_b: { state: 'OFF' } }),
      'utf8',
    );

    const sm1 = await StateManager.create(
      'port_a',
      config1,
      pp1,
      'homenet',
      new Map(),
      undefined,
      configPath1,
    );
    const sm2 = await StateManager.create(
      'port_b',
      config2,
      pp2,
      'homenet',
      new Map(),
      undefined,
      configPath2,
    );

    // Each port should only see its own entities
    expect(sm1.getEntityState('light_a')).toEqual({ state: 'ON' });
    expect(sm1.getEntityState('switch_b')).toBeUndefined();

    expect(sm2.getEntityState('switch_b')).toEqual({ state: 'OFF' });
    expect(sm2.getEntityState('light_a')).toBeUndefined();
  });
});

describe('Local State Restore Publishing', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homenet-test-'));
    configPath = path.join(tempDir, 'homenet_bridge.yaml');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('should publish restored local states on the same topic as regular state updates', () => {
    const config: HomenetBridgeConfig = {
      serial: {
        portId: PORT_ID,
        path: '/dev/null',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      light: [{ id: 'livingroom_light_1', name: 'Living Room Light' }],
    };
    const packetProcessor = new PacketProcessor(config, { getEntityState: () => undefined } as any);
    const published: Array<{ topic: string; payload: string }> = [];
    const listener = (event: { topic: string; payload: string }) =>
      published.push({ topic: event.topic, payload: event.payload });
    eventBus.on('state:changed', listener);
    const stateManager = new StateManager(PORT_ID, config, packetProcessor, 'homenet');

    try {
      stateManager.updateEntityState('livingroom_light_1', { state: 'OFF' });
      published.length = 0;

      stateManager.publishRestoredLocalStates();
    } finally {
      eventBus.off('state:changed', listener);
    }

    expect(published).toEqual([
      {
        topic: 'homenet/livingroom_light_1/state',
        payload: JSON.stringify({ state: 'OFF' }),
      },
    ]);
  });

  it('should preserve dots in restored local state topics', () => {
    const config: HomenetBridgeConfig = {
      serial: {
        portId: PORT_ID,
        path: '/dev/null',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      light: [{ id: 'light.livingroom', name: 'Living Room Light' }],
    };
    const packetProcessor = new PacketProcessor(config, { getEntityState: () => undefined } as any);
    const published: Array<{ topic: string; payload: string }> = [];
    const listener = (event: { topic: string; payload: string }) =>
      published.push({ topic: event.topic, payload: event.payload });
    eventBus.on('state:changed', listener);
    const stateManager = new StateManager(PORT_ID, config, packetProcessor, 'homenet');

    try {
      stateManager.updateEntityState('light.livingroom', { state: 'ON' });
      published.length = 0;

      stateManager.publishRestoredLocalStates();
    } finally {
      eventBus.off('state:changed', listener);
    }

    expect(published[0]?.topic).toBe('homenet/light.livingroom/state');
  });

  it('should not restore non-restorable optimistic entities from disk cache', async () => {
    const config: HomenetBridgeConfig = {
      serial: {
        portId: PORT_ID,
        path: '/dev/null',
        baud_rate: 9600,
        data_bits: 8,
        parity: 'none',
        stop_bits: 1,
      },
      light: [{ id: 'light.livingroom', name: 'Living Room Light', optimistic: true }],
    };
    const packetProcessor = new PacketProcessor(config, { getEntityState: () => undefined } as any);
    const cacheFilePath = path.join(tempDir, cacheFileName);
    fs.writeFileSync(
      cacheFilePath,
      JSON.stringify({ 'light.livingroom': { state: 'ON' } }),
      'utf8',
    );

    const stateManager = await StateManager.create(
      PORT_ID,
      config,
      packetProcessor,
      'homenet',
      new Map(),
      undefined,
      configPath,
    );

    expect(stateManager.getEntityState('light.livingroom')).toEqual({ state: 'OFF' });
    expect(JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'))).toEqual({
      'light.livingroom': { state: 'OFF' },
    });
  });
});
