// packages/core/src/state/state-manager.ts

import { Buffer } from 'buffer';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { HomenetBridgeConfig } from '../config/types.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { logger } from '../utils/logger.js';
import { eventBus } from '../service/event-bus.js';
import { stateCache } from './store.js';
import { ENTITY_TYPE_KEYS } from '../utils/entities.js';
import { EntityConfig, RestoreMode } from '../domain/entities/base.entity.js';

/** Async replacement for fs.existsSync – resolves to true when the path is accessible. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Check whether a restore_mode value requires MQTT retained restore. */
function isRestorableMode(mode?: RestoreMode): boolean {
  return mode === 'RESTORE_DEFAULT_ON' || mode === 'RESTORE_DEFAULT_OFF';
}

/** Get the ON-equivalent default state for the given entity type. */
function getOnState(entityType: string): Record<string, any> | null {
  const onStateByType: Record<string, Record<string, any>> = {
    binary_sensor: { state: 'ON' },
    switch: { state: 'ON' },
    light: { state: 'ON' },
    valve: { state: 'OPEN' },
    cover: { state: 'OPEN' },
    fan: { state: 'ON' },
    lock: { state: 'UNLOCKED' },
  };
  return onStateByType[entityType] ? { ...onStateByType[entityType] } : null;
}

export interface StatePublisher {
  publish(topic: string, payload: string, options?: { retain?: boolean }): void | Promise<void>;
}

export class StateManager {
  private packetProcessor: PacketProcessor;
  private portId: string;
  private topicPrefix: string;
  private ignoredEntityId: string | null = null;
  private sharedStates?: Map<string, Record<string, any>>;
  private internalEntityIds: Set<string>;
  private configEntityIds: Set<string>;
  private nonRestorableOptimisticEntityIds: Set<string>;
  private statePublisher?: StatePublisher;
  private statesCachePath: string | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    portId: string,
    config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    mqttPublisherOrTopicPrefix: any,
    mqttTopicPrefixOrSharedStates?: any,
    legacySharedStates?: Map<string, Record<string, any>>,
    configPath?: string,
  ) {
    this.portId = portId;
    this.packetProcessor = packetProcessor;

    let topicPrefix = 'homenet';
    let sharedStates: Map<string, Record<string, any>> | undefined;

    if (typeof mqttPublisherOrTopicPrefix === 'string') {
      topicPrefix = mqttPublisherOrTopicPrefix;
      sharedStates = mqttTopicPrefixOrSharedStates;
    } else {
      if (mqttPublisherOrTopicPrefix && typeof mqttPublisherOrTopicPrefix.publish === 'function') {
        this.statePublisher = mqttPublisherOrTopicPrefix;
      }
      if (typeof mqttTopicPrefixOrSharedStates === 'string') {
        topicPrefix = mqttTopicPrefixOrSharedStates;
      }
      sharedStates = legacySharedStates;
    }

    this.topicPrefix = topicPrefix;
    this.sharedStates = sharedStates;

    // Build known entity ID set from config (must happen before loadLocalCache)
    this.configEntityIds = new Set<string>();
    this.nonRestorableOptimisticEntityIds = new Set<string>();
    for (const type of ENTITY_TYPE_KEYS) {
      const entities = config[type] as EntityConfig[] | undefined;
      if (entities) {
        for (const entity of entities) {
          if (entity.id) {
            this.configEntityIds.add(entity.id);
            const mode: RestoreMode = entity.restore_mode ?? 'ALWAYS_OFF';
            if (entity.optimistic && !isRestorableMode(mode)) {
              this.nonRestorableOptimisticEntityIds.add(entity.id);
            }
          }
        }
      }
    }

    if (configPath) {
      const configDir = path.dirname(configPath);
      this.statesCachePath = path.join(configDir, `states_cache_${portId}.json`);
    }

    // Extract internal entity IDs from config
    this.internalEntityIds = new Set<string>();
    for (const type of ENTITY_TYPE_KEYS) {
      const entities = config[type] as EntityConfig[] | undefined;
      if (entities) {
        for (const entity of entities) {
          if (entity.internal === true && entity.id) {
            this.internalEntityIds.add(entity.id);
          }
        }
      }
    }

    // Initialize optimistic entities with default state
    // This ensures they exist in states before any automation guard evaluates them
    this.initializeOptimisticEntities(config);

    if (typeof (this.packetProcessor as any).on === 'function') {
      this.packetProcessor.on('state', (event: { deviceId: string; state: any }) => {
        this.handleStateUpdate(event);
      });
    } else {
      logger.warn(
        '[StateManager] PacketProcessor does not support events; state updates will not be processed automatically',
      );
    }
  }

  public setIgnoreEntity(entityId: string | null) {
    this.ignoredEntityId = entityId;
  }

  public processIncomingData(chunk: Buffer): void {
    // Emit raw data for the service/UI to consume
    // Optimization: avoid string allocation if not needed
    if (logger.isLevelEnabled('trace') || eventBus.listenerCount('raw-data') > 0) {
      const hex = chunk.toString('hex');
      logger.trace({ hex }, '[core] Received chunk');
      eventBus.emit('raw-data', hex);
    }
    this.packetProcessor.processChunk(chunk);
  }

  /**
   * Initialize optimistic entities with default states.
   * This ensures they exist in deviceStates/sharedStates before any automation guard evaluates them.
   */
  private getOptimisticDefaultState(entityType: string): Record<string, any> | null {
    const defaultStateByType: Record<string, Record<string, any>> = {
      binary_sensor: { state: 'OFF' },
      switch: { state: 'OFF' },
      light: { state: 'OFF' },
      valve: { state: 'CLOSED' },
      cover: { state: 'CLOSED' },
      fan: { state: 'OFF' },
      lock: { state: 'LOCKED' },
      button: {}, // Buttons don't have persistent state
      sensor: {}, // Sensors need actual values, skip
      climate: {}, // Climate has complex state, skip
      text: {}, // Text needs initial_value, handled by TextDevice
    };

    const defaultState = defaultStateByType[entityType];
    if (!defaultState || Object.keys(defaultState).length === 0) {
      return null;
    }

    return { ...defaultState };
  }

  /**
   * Initialize non-restorable optimistic entities with default states.
   * ALWAYS_OFF / ALWAYS_ON entities are initialized here immediately.
   * RESTORE_DEFAULT_* entities are deferred until after MQTT retained restore.
   */
  private initializeOptimisticEntities(config: HomenetBridgeConfig): void {
    this.initializeOptimisticDefaults(config, false);
  }

  /**
   * Initialize restorable optimistic entities that were NOT restored from MQTT retained.
   * Called after MQTT retained restore attempt completes.
   */
  public initializeRestorableOptimisticDefaults(config: HomenetBridgeConfig): void {
    this.initializeOptimisticDefaults(config, true);
  }

  private initializeOptimisticDefaults(config: HomenetBridgeConfig, onlyRestorable: boolean): void {
    for (const type of ENTITY_TYPE_KEYS) {
      const entities = config[type] as EntityConfig[] | undefined;

      if (!entities) {
        continue;
      }

      for (const entity of entities) {
        if (!entity.optimistic || !entity.id) continue;

        const mode: RestoreMode = entity.restore_mode ?? 'ALWAYS_OFF';
        const restorable = isRestorableMode(mode);

        // Phase filtering: non-restorable first, restorable second
        if (onlyRestorable !== restorable) continue;

        // Only initialize if not already in deviceStates (e.g. already restored)
        if (this.deviceStates.has(entity.id)) continue;

        const defaultState = this.getDefaultStateForMode(type, mode);
        if (!defaultState) continue;

        this.applyStateUpdate(entity.id, defaultState);
        logger.debug(
          `[StateManager] Initialized optimistic entity ${entity.id} with mode=${mode}, state: ${JSON.stringify(defaultState)}`,
        );
      }
    }
  }

  /**
   * Determine the default state for an entity based on its restore_mode.
   */
  private getDefaultStateForMode(
    entityType: string,
    mode: RestoreMode,
  ): Record<string, any> | null {
    switch (mode) {
      case 'ALWAYS_ON':
      case 'RESTORE_DEFAULT_ON':
        return getOnState(entityType) ?? this.getOptimisticDefaultState(entityType);
      case 'ALWAYS_OFF':
      case 'RESTORE_DEFAULT_OFF':
      default:
        return this.getOptimisticDefaultState(entityType);
    }
  }

  private deviceStates = new Map<string, any>();

  public restoreEntityState(entityId: string, state: Record<string, any>): void {
    const newState = { ...state };
    this.deviceStates.set(entityId, newState);
    this.cachedStates = null;

    if (this.sharedStates) {
      this.sharedStates.set(entityId, newState);
    }

    const topic = `${this.topicPrefix}/${entityId}/state`;
    const payload = JSON.stringify(newState);
    stateCache.set(topic, payload);

    if (!this.internalEntityIds.has(entityId)) {
      if (this.statePublisher) {
        this.statePublisher.publish(topic, payload, { retain: true });
      }

      const timestamp = new Date().toISOString();
      eventBus.emit('state:changed', {
        portId: this.portId,
        entityId,
        topic,
        payload,
        state: newState,
        oldState: {},
        changes: newState,
        timestamp,
      });
      eventBus.emit(`device:${entityId}:state:changed`, newState);
    }

    this.saveStatesDebounced();
    logger.info({ entityId, topic }, '[StateManager] Restored entity state from MQTT retained');
  }

  public getLightState(entityId: string): { isOn: boolean } | undefined {
    const state = this.deviceStates.get(entityId);
    if (state && typeof state.isOn === 'boolean') {
      return { isOn: state.isOn };
    }
    return undefined;
  }

  public getClimateState(entityId: string): { targetTemperature: number } | undefined {
    const state = this.deviceStates.get(entityId);
    if (state && typeof state.targetTemperature === 'number') {
      return { targetTemperature: state.targetTemperature };
    }
    return undefined;
  }

  private cachedStates: Record<string, any> | null = null;

  public getAllStates(): Record<string, any> {
    if (this.cachedStates) {
      return this.cachedStates;
    }
    this.cachedStates = Object.fromEntries(this.deviceStates);
    return this.cachedStates;
  }

  public getEntityState(entityId: string): any {
    return this.deviceStates.get(entityId);
  }

  public updateEntityState(entityId: string, state: Record<string, any>) {
    this.applyStateUpdate(entityId, state);
  }

  private handleStateUpdate(event: { deviceId: string; state: any }) {
    const { deviceId, state } = event;
    this.applyStateUpdate(deviceId, state);
  }

  private applyStateUpdate(deviceId: string, state: Record<string, any>) {
    if (this.ignoredEntityId && deviceId === this.ignoredEntityId) {
      return;
    }

    const currentState = this.deviceStates.get(deviceId) || {};

    // Optimization: Check if state actually changed
    // Most updates are redundant (repeating the same values).
    // We do a shallow comparison of primitives to avoid expensive object creation and JSON.stringify.
    let hasChanges = false;
    for (const key in state) {
      if (currentState[key] !== state[key]) {
        hasChanges = true;
        break;
      }
    }

    // If no changes detected and we already have state, skip processing
    if (!hasChanges && Object.keys(currentState).length > 0) {
      if (logger.isLevelEnabled('trace')) {
        logger.trace(`[StateManager] ${deviceId}: [unchanged]`);
      }
      return;
    }

    const newState = { ...currentState, ...state };
    this.deviceStates.set(deviceId, newState);
    this.cachedStates = null; // Invalidate cache

    // Update shared global state if available
    if (this.sharedStates) {
      this.sharedStates.set(deviceId, newState);
    }

    const topic = `${this.topicPrefix}/${deviceId}/state`;
    const payload = JSON.stringify(newState);

    // Double check with cache (handles reference types like arrays that always fail strict equality)
    if (stateCache.get(topic) !== payload) {
      stateCache.set(topic, payload);

      // Skip MQTT publish and event emission for internal entities
      // Internal state is still stored in deviceStates/sharedStates for automation use
      if (this.internalEntityIds.has(deviceId)) {
        if (logger.isLevelEnabled('debug')) {
          logger.debug(`[StateManager] ${deviceId}: [internal, skipping publish]`);
        }
        return;
      }

      if (logger.isLevelEnabled('info')) {
        const stateStr = payload.replace(/["{}]/g, '').replace(/,/g, ', ');
        logger.info(`[StateManager] ${deviceId}: {${stateStr}} → ${topic} [published]`);
      }
      if (this.statePublisher) {
        this.statePublisher.publish(topic, payload, { retain: true });
      }
      const timestamp = new Date().toISOString();
      eventBus.emit('state:changed', {
        portId: this.portId,
        entityId: deviceId,
        topic,
        payload,
        state: newState,
        oldState: currentState,
        changes: state,
        timestamp,
      });
      eventBus.emit(`device:${deviceId}:state:changed`, newState);
      this.saveStatesDebounced();
    } else {
      if (logger.isLevelEnabled('trace')) {
        const stateStr = payload.replace(/["{}]/g, '').replace(/,/g, ', ');
        logger.trace(`[StateManager] ${deviceId}: {${stateStr}} [unchanged]`);
      }
    }
  }

  /**
   * Static factory that constructs a StateManager and runs async I/O
   * (legacy-cache migration + local-cache load) before returning.
   */
  static async create(
    portId: string,
    config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    mqttPublisherOrTopicPrefix: any,
    mqttTopicPrefixOrSharedStates?: any,
    legacySharedStates?: Map<string, Record<string, any>>,
    configPath?: string,
  ): Promise<StateManager> {
    const sm = new StateManager(
      portId,
      config,
      packetProcessor,
      mqttPublisherOrTopicPrefix,
      mqttTopicPrefixOrSharedStates,
      legacySharedStates,
      configPath,
    );
    await sm.init();
    return sm;
  }

  /**
   * Perform async initialisation that cannot run inside the constructor:
   * legacy cache migration and local-cache loading.
   */
  async init(): Promise<void> {
    if (!this.statesCachePath) return;

    // Migrate from legacy shared cache file if per-port cache doesn't exist yet
    const cacheExists = await fileExists(this.statesCachePath);
    if (!cacheExists) {
      const configDir = path.dirname(this.statesCachePath);
      const legacyCachePath = path.join(configDir, 'states_cache.json');
      if (await fileExists(legacyCachePath)) {
        try {
          await fsPromises.copyFile(legacyCachePath, this.statesCachePath);
          await fsPromises.unlink(legacyCachePath);
          logger.info(
            { from: 'states_cache.json', to: path.basename(this.statesCachePath) },
            '[StateManager] Migrated and removed legacy shared cache',
          );
        } catch (err) {
          logger.warn({ err }, '[StateManager] Failed to migrate legacy cache, starting fresh');
        }
      }
    }

    await this.loadLocalCache();
  }

  private async loadLocalCache(): Promise<void> {
    if (!this.statesCachePath) return;
    try {
      if (!(await fileExists(this.statesCachePath))) {
        return;
      }
      const dataStr = await fsPromises.readFile(this.statesCachePath, 'utf8');
      const cached = JSON.parse(dataStr) as Record<string, any>;
      if (cached && typeof cached === 'object') {
        let restoredCount = 0;
        let skippedCount = 0;
        for (const [entityId, state] of Object.entries(cached)) {
          if (
            !this.configEntityIds.has(entityId) ||
            this.nonRestorableOptimisticEntityIds.has(entityId)
          ) {
            skippedCount++;
            continue;
          }
          this.deviceStates.set(entityId, state);
          if (this.sharedStates) {
            this.sharedStates.set(entityId, state);
          }
          restoredCount++;
        }
        logger.info(
          { restored: restoredCount, skipped: skippedCount, path: this.statesCachePath },
          '[StateManager] Loaded states cache from disk',
        );
        if (skippedCount > 0) {
          logger.info(
            { skipped: skippedCount },
            '[StateManager] Skipped unavailable or non-restorable entities from states cache',
          );
          // Rewrite cache file with only restorable valid entities to permanently remove stale entries
          const cleanedData = Object.fromEntries(this.deviceStates);
          await fsPromises.writeFile(
            this.statesCachePath,
            JSON.stringify(cleanedData, null, 2),
            'utf8',
          );
          logger.info(
            { path: this.statesCachePath },
            '[StateManager] Cleaned skipped entities from states cache file',
          );
        }
      }
    } catch (err) {
      logger.error(
        { err, path: this.statesCachePath },
        '[StateManager] Failed to load states cache from disk',
      );
    }
  }

  private saveStatesDebounced() {
    if (!this.statesCachePath) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      try {
        const cacheData = Object.fromEntries(this.deviceStates);
        await fsPromises.writeFile(
          this.statesCachePath!,
          JSON.stringify(cacheData, null, 2),
          'utf8',
        );
        logger.debug({ path: this.statesCachePath }, '[StateManager] Saved states cache to disk');
      } catch (err) {
        logger.error(
          { err, path: this.statesCachePath },
          '[StateManager] Failed to save states cache to disk',
        );
      }
    }, 1000);
  }

  public publishRestoredLocalStates(): void {
    if (this.deviceStates.size === 0) return;
    logger.info(
      { count: this.deviceStates.size },
      '[StateManager] Publishing restored local states to connectors',
    );
    for (const [entityId, state] of this.deviceStates.entries()) {
      if (this.internalEntityIds.has(entityId)) continue;

      const topic = `${this.topicPrefix}/${entityId}/state`;
      const payload = typeof state === 'string' ? state : JSON.stringify(state);
      const timestamp = new Date().toISOString();

      eventBus.emit('state:changed', {
        portId: this.portId,
        entityId,
        topic,
        payload,
        state,
        oldState: {},
        changes: state,
        timestamp,
      });
      eventBus.emit(`device:${entityId}:state:changed`, state);
    }
  }
}
