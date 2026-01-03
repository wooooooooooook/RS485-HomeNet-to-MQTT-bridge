import parser from 'cron-parser';
import { EventEmitter } from 'node:events';

import type {
  AutomationAction,
  AutomationActionChoose,
  AutomationActionCommand,
  AutomationActionDelay,
  AutomationActionIf,
  AutomationActionLog,
  AutomationActionPublish,
  AutomationActionRepeat,
  AutomationActionScript,
  AutomationActionSendPacket,
  AutomationActionStop,
  AutomationActionUpdateState,
  AutomationActionUpdateStateValue,
  AutomationActionWaitUntil,
  AutomationConfig,
  AutomationGuard,
  AutomationTrigger,
  AutomationTriggerPacket,
  AutomationTriggerSchedule,
  AutomationTriggerState,
  HomenetBridgeConfig,
  ScriptConfig,
} from '../config/types.js';
import type { StateNumSchema, StateSchema } from '../protocol/types.js';
import { extractFromSchema } from '../protocol/schema-utils.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { CelExecutor } from '../protocol/cel-executor.js';
import { CommandManager } from '../service/command.manager.js';
import { eventBus } from '../service/event-bus.js';
import { StateManager } from '../state/state-manager.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { parseDuration } from '../utils/duration.js';
import { findEntityById } from '../utils/entities.js';
import { logger } from '../utils/logger.js';
import { matchesPacket } from '../utils/packet-matching.js';
import {
  calculateChecksumFromBuffer,
  calculateChecksum2FromBuffer,
  ChecksumType,
  Checksum2Type,
} from '../protocol/utils/checksum.js';

type TriggerContextType = AutomationTrigger['type'] | 'command' | 'script';

interface TriggerContext {
  type: TriggerContextType;
  state?: Record<string, any>;
  packet?: number[];
  timestamp: number;
}

// Updated PacketSender signature to match CommandManager.sendRaw capabilities
type CommandSender = (
  portId: string | undefined,
  packet: number[],
  options?: {
    priority?: 'normal' | 'low';
    ackMatch?: any;
    retry?: number;
    timeout?: number;
    interval?: number;
  },
) => Promise<void>;

export class AutomationManager {
  private readonly automationList: AutomationConfig[];
  private readonly packetProcessor: PacketProcessor;
  private readonly commandManager: CommandManager;
  private readonly mqttPublisher: MqttPublisher;
  private readonly celExecutor = new CelExecutor();
  private readonly debounceTracker = new Map<string, number>();
  private readonly automationTimers = new Map<string, NodeJS.Timeout[]>();
  private readonly subscriptions: {
    emitter: EventEmitter;
    event: string;
    handler: (...args: any[]) => void;
  }[] = [];
  private readonly states = new Map<string, Record<string, any>>();
  private readonly scripts = new Map<string, ScriptConfig>();
  private readonly runningAutomations = new Map<string, AbortController>();
  private readonly automationQueues = new Map<string, Array<() => Promise<void>>>();
  private isStarted = false;

  constructor(
    private readonly config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    commandManager: CommandManager,
    mqttPublisher: MqttPublisher,
    private readonly contextPortId?: string,
    private readonly commandSender?: CommandSender,
    private readonly stateManager?: StateManager,
  ) {
    this.automationList = (config.automation || []).filter(
      (automation) => automation.enabled !== false,
    );
    this.packetProcessor = packetProcessor;
    this.commandManager = commandManager;
    this.mqttPublisher = mqttPublisher;
    (config.scripts || []).forEach((script) => this.scripts.set(script.id, script));
  }

  private normalizeCommandName(commandName: string) {
    return commandName.startsWith('command_') ? commandName : `command_${commandName}`;
  }

  private summarizeAction(action: AutomationAction): string {
    const actionType = action.action;
    if (actionType === 'command') {
      return `command:${(action as AutomationActionCommand).target}`;
    }
    if (actionType === 'publish') {
      return `publish:${(action as AutomationActionPublish).topic}`;
    }
    if (actionType === 'log') {
      return `log:${(action as AutomationActionLog).message}`;
    }
    if (actionType === 'delay') {
      return `delay:${(action as AutomationActionDelay).milliseconds}`;
    }
    if (actionType === 'script') {
      const scriptId = (action as AutomationActionScript).script ?? 'unknown';
      return `script:${scriptId}`;
    }
    if (actionType === 'send_packet') {
      return 'send_packet';
    }
    if (actionType === 'update_state') {
      return `update_state:${(action as AutomationActionUpdateState).target_id}`;
    }
    if (actionType === 'if') {
      return 'if';
    }
    if (actionType === 'choose') {
      return 'choose';
    }
    if (actionType === 'repeat') {
      return 'repeat';
    }
    if (actionType === 'wait_until') {
      return 'wait_until';
    }
    if (actionType === 'stop') {
      return 'stop';
    }
    return actionType;
  }

  private getCommandSchema(entity: any, commandName: string) {
    const normalized = this.normalizeCommandName(commandName);
    const schema = (entity as any)[normalized] as any;
    return { normalized, schema };
  }

  public async runScript(
    scriptId: string,
    context: TriggerContext,
    stack: string[] = [],
  ): Promise<void> {
    const script = this.scripts.get(scriptId);

    if (!script) {
      logger.warn({ script: scriptId }, '[automation] 정의되지 않은 script를 호출했습니다.');
      return;
    }

    if (stack.includes(scriptId)) {
      logger.warn({ script: scriptId }, '[automation] script가 순환 호출되어 실행을 중단합니다.');
      return;
    }

    const nextStack = [...stack, scriptId];
    const scriptContext: TriggerContext = { ...context, type: 'script', timestamp: Date.now() };

    logger.info({ script: scriptId }, '[automation] Script 실행 시작');
    for (const action of script.actions) {
      eventBus.emit('script:action', {
        scriptId,
        action: this.summarizeAction(action),
        portId: this.contextPortId,
        timestamp: Date.now(),
      });
      await this.executeAction(action, scriptContext, this.contextPortId, nextStack);
    }
  }

  public addAutomation(config: AutomationConfig) {
    this.automationList.push(config);
    if (this.isStarted) {
      this.setupAutomationTriggers(config);
    }
  }

  public removeAutomation(id: string) {
    const index = this.automationList.findIndex((a) => a.id === id);
    if (index !== -1) {
      this.automationList.splice(index, 1);
    }
    this.clearAutomationTimers(id);
  }

  public upsertAutomation(config: AutomationConfig) {
    const index = this.automationList.findIndex((a) => a.id === config.id);
    if (index !== -1) {
      this.automationList[index] = config;
      this.clearAutomationTimers(config.id);
    } else {
      this.automationList.push(config);
    }
    if (this.isStarted) {
      this.setupAutomationTriggers(config);
    }
  }

  public upsertScript(script: ScriptConfig) {
    this.scripts.set(script.id, script);
  }

  public removeScript(id: string) {
    this.scripts.delete(id);
  }

  public async runAutomationThen(automation: AutomationConfig) {
    const context: TriggerContext = { type: 'command', timestamp: Date.now() };
    eventBus.emit('automation:triggered', {
      automationId: automation.id,
      triggerType: context.type,
      portId: this.contextPortId,
      timestamp: Date.now(),
    });
    await this.runActions(automation.then, context, this.contextPortId, automation.id);
  }

  public async runActions(
    actions: AutomationAction[],
    context: TriggerContext,
    automationPortId?: string,
    automationId?: string,
  ) {
    for (const action of actions) {
      if (automationId) {
        eventBus.emit('automation:action', {
          automationId,
          triggerType: context.type,
          action: this.summarizeAction(action),
          portId: automationPortId ?? this.contextPortId,
          timestamp: Date.now(),
        });
      }
      await this.executeAction(action, context, automationPortId, []);
    }
  }

  start() {
    if (this.isStarted) return;
    this.isStarted = true;

    const stateListener = ({
      entityId,
      state,
    }: {
      entityId: string;
      state: Record<string, any>;
    }) => {
      const previous = this.states.get(entityId) || {};
      this.states.set(entityId, { ...previous, ...state });
      this.handleStateTriggers(entityId, state);
    };
    this.bind(eventBus, 'state:changed', stateListener);

    const packetListener = (packet: Buffer) => this.handlePacketTriggers(packet);
    this.bind(this.packetProcessor, 'packet', packetListener);

    for (const automation of this.automationList) {
      this.setupAutomationTriggers(automation);
    }
  }

  stop() {
    this.clearAllAutomationTimers();
    for (const { emitter, event, handler } of this.subscriptions) {
      emitter.removeListener(event, handler);
    }
    this.subscriptions.length = 0;
    this.isStarted = false;
  }

  private bind(emitter: EventEmitter, event: string, handler: (...args: any[]) => void) {
    emitter.on(event, handler);
    this.subscriptions.push({ emitter, event, handler });
  }

  private setupAutomationTriggers(automation: AutomationConfig) {
    for (const trigger of automation.trigger) {
      if (trigger.type === 'schedule') {
        this.setupScheduleTrigger(automation, trigger);
      }
      if (trigger.type === 'startup') {
        const timeout = setTimeout(
          () => this.runAutomation(automation, trigger, { type: 'startup', timestamp: Date.now() }),
          0,
        );
        this.trackAutomationTimer(automation.id, timeout);
      }
    }
  }

  private setupScheduleTrigger(automation: AutomationConfig, trigger: AutomationTriggerSchedule) {
    if (trigger.every === undefined && !trigger.cron) {
      logger.warn(
        { automation: automation.id },
        '[automation] schedule trigger missing interval or cron',
      );
      return;
    }

    const every = trigger.every !== undefined ? parseDuration(trigger.every as any) : undefined;

    if (every !== undefined) {
      const interval = setInterval(() => {
        this.runAutomation(automation, trigger, { type: 'schedule', timestamp: Date.now() });
      }, every);
      this.trackAutomationTimer(automation.id, interval);
    }

    if (trigger.cron) {
      try {
        const cron = parser.parseExpression(trigger.cron, { utc: true });
        const scheduleNext = () => {
          if (!this.isAutomationActive(automation.id)) return;
          const next = cron.next().toDate();
          const delay = Math.max(0, next.getTime() - Date.now());
          const timeout = setTimeout(() => {
            if (!this.isAutomationActive(automation.id)) return;
            this.runAutomation(automation, trigger, { type: 'schedule', timestamp: Date.now() });
            scheduleNext();
          }, delay);
          this.trackAutomationTimer(automation.id, timeout);
        };
        scheduleNext();
      } catch (error) {
        logger.error({ error, cron: trigger.cron }, '[automation] Invalid cron expression');
      }
    }
  }

  private isAutomationActive(automationId: string) {
    return this.automationList.some((automation) => automation.id === automationId);
  }

  private trackAutomationTimer(automationId: string, timer: NodeJS.Timeout) {
    const timers = this.automationTimers.get(automationId) ?? [];
    timers.push(timer);
    this.automationTimers.set(automationId, timers);
  }

  private clearAutomationTimers(automationId: string) {
    const timers = this.automationTimers.get(automationId);
    if (!timers) return;
    timers.forEach((timer) => {
      clearTimeout(timer);
      clearInterval(timer);
    });
    this.automationTimers.delete(automationId);
  }

  private clearAllAutomationTimers() {
    for (const timers of this.automationTimers.values()) {
      timers.forEach((timer) => {
        clearTimeout(timer);
        clearInterval(timer);
      });
    }
    this.automationTimers.clear();
  }

  private handleStateTriggers(entityId: string, state: Record<string, any>) {
    for (const automation of this.automationList) {
      for (const trigger of automation.trigger) {
        if (trigger.type !== 'state') continue;
        if (trigger.entity_id !== entityId) continue;
        const context: TriggerContext = { type: 'state', state, timestamp: Date.now() };
        if (!this.matchesStateTrigger(trigger, state)) continue;
        this.runAutomation(automation, trigger, context);
      }
    }
  }

  private handlePacketTriggers(packet: Buffer) {
    for (const automation of this.automationList) {
      for (const trigger of automation.trigger) {
        if (trigger.type !== 'packet') continue;
        if (!this.matchesPacket(trigger, packet)) continue;
        const context: TriggerContext = {
          type: 'packet',
          packet: Array.from(packet),
          timestamp: Date.now(),
        };
        this.runAutomation(automation, trigger, context);
      }
    }
  }

  private matchesPacket(trigger: AutomationTriggerPacket, packet: Buffer) {
    return matchesPacket(trigger.match as StateSchema, packet);
  }

  private matchesStateTrigger(trigger: AutomationTriggerState, state: Record<string, any>) {
    const value = trigger.property ? state[trigger.property] : state;
    if (!this.matchesValue(value, trigger.match)) return false;

    if (trigger.debounce_ms) {
      const debounce = parseDuration(trigger.debounce_ms as any) ?? 0;
      const key = `${trigger.entity_id}:${trigger.property ?? '*'}:${trigger.match ?? 'any'}`;
      const last = this.debounceTracker.get(key);
      const now = Date.now();
      if (last && now - last < debounce) {
        return false;
      }
      this.debounceTracker.set(key, now);
    }

    return true;
  }

  private matchesValue(value: any, expected: any): boolean {
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
  }

  private async runAutomation(
    automation: AutomationConfig,
    trigger: AutomationTrigger,
    context: TriggerContext,
  ) {
    const mode = automation.mode || 'parallel';
    const automationId = automation.id;

    eventBus.emit('automation:triggered', {
      automationId,
      triggerType: trigger.type,
      portId: this.contextPortId,
      timestamp: Date.now(),
    });

    // Handle mode-specific behavior
    if (mode === 'single') {
      if (this.runningAutomations.has(automationId)) {
        logger.debug(
          { automation: automationId },
          '[automation] Skipped (single mode, already running)',
        );
        return;
      }
    } else if (mode === 'restart') {
      const existing = this.runningAutomations.get(automationId);
      if (existing) {
        logger.debug(
          { automation: automationId },
          '[automation] Aborting previous run (restart mode)',
        );
        existing.abort();
      }
    } else if (mode === 'queued') {
      if (this.runningAutomations.has(automationId)) {
        // Add to queue and return
        const queue = this.automationQueues.get(automationId) || [];
        queue.push(() => this.executeAutomation(automation, trigger, context));
        this.automationQueues.set(automationId, queue);
        logger.debug(
          { automation: automationId, queueLength: queue.length },
          '[automation] Queued',
        );
        return;
      }
    }
    // parallel mode: just run without any checks

    await this.executeAutomation(automation, trigger, context);
  }

  private async executeAutomation(
    automation: AutomationConfig,
    trigger: AutomationTrigger,
    context: TriggerContext,
  ) {
    const automationId = automation.id;
    const mode = automation.mode || 'parallel';
    const abortController = new AbortController();

    // Track running automation (except parallel mode)
    if (mode !== 'parallel') {
      this.runningAutomations.set(automationId, abortController);
    }

    try {
      const guardResult =
        this.evaluateGuard(trigger.guard, context) && this.evaluateGuard(automation.guard, context);
      eventBus.emit('automation:guard', {
        automationId,
        triggerType: trigger.type,
        result: guardResult,
        portId: this.contextPortId,
        timestamp: Date.now(),
      });
      const actions = guardResult ? automation.then : automation.else;
      if (!actions || actions.length === 0) return;

      logger.info(
        { automation: automationId, trigger: trigger.type, mode },
        '[automation] Executing',
      );
      for (const action of actions) {
        eventBus.emit('automation:action', {
          automationId,
          triggerType: trigger.type,
          action: this.summarizeAction(action),
          portId: this.contextPortId,
          timestamp: Date.now(),
        });
        // Check if aborted
        if (abortController.signal.aborted) {
          logger.debug({ automation: automationId }, '[automation] Aborted');
          return;
        }

        try {
          await this.executeAction(
            action,
            context,
            this.contextPortId,
            [],
            abortController.signal,
            automationId,
          );
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            logger.debug({ automation: automationId }, '[automation] Aborted during action');
            return;
          }
          if ((error as Error).name === 'StopActionError') {
            logger.debug(
              { automation: automationId, reason: (error as Error).message },
              '[automation] Stopped by stop action',
            );
            return;
          }
          logger.error(
            { error, automation: automationId, action: action.action },
            '[automation] Action failed',
          );
        }
      }
    } finally {
      // Clean up tracking
      if (mode !== 'parallel') {
        this.runningAutomations.delete(automationId);
      }

      // Process queue for queued mode
      if (mode === 'queued') {
        const queue = this.automationQueues.get(automationId);
        if (queue && queue.length > 0) {
          const next = queue.shift()!;
          if (queue.length === 0) {
            this.automationQueues.delete(automationId);
          }
          // Run next in queue
          next();
        }
      }
    }
  }

  private evaluateGuard(guard: AutomationGuard | undefined, context: TriggerContext) {
    if (!guard) return true;
    // guard is now a CEL string.
    const result = this.celExecutor.execute(guard, this.buildContext(context));
    return Boolean(result);
  }

  private async executeAction(
    action: AutomationAction,
    context: TriggerContext,
    automationPortId?: string,
    scriptStack: string[] = [],
    signal?: AbortSignal,
    automationId?: string,
  ) {
    if (action.action === 'command') return this.executeCommandAction(action, context, scriptStack);
    if (action.action === 'publish') return this.executePublishAction(action, context);
    if (action.action === 'log')
      return this.executeLogAction(action as AutomationActionLog, context);
    if (action.action === 'delay')
      return this.executeDelayAction(action as AutomationActionDelay, signal);
    if (action.action === 'script') return this.executeScriptAction(action, context, scriptStack);
    if (action.action === 'send_packet')
      return this.executeSendPacketAction(
        action as AutomationActionSendPacket,
        context,
        automationPortId,
        scriptStack,
        automationId,
      );
    if (action.action === 'update_state')
      return this.executeUpdateStateAction(action as AutomationActionUpdateState, context);
    if (action.action === 'if')
      return this.executeIfAction(
        action as AutomationActionIf,
        context,
        automationPortId,
        scriptStack,
        signal,
      );
    if (action.action === 'repeat')
      return this.executeRepeatAction(
        action as AutomationActionRepeat,
        context,
        automationPortId,
        scriptStack,
        signal,
      );
    if (action.action === 'wait_until')
      return this.executeWaitUntilAction(action as AutomationActionWaitUntil, context, signal);
    if (action.action === 'choose')
      return this.executeChooseAction(
        action as AutomationActionChoose,
        context,
        automationPortId,
        scriptStack,
        signal,
      );
    if (action.action === 'stop') return this.executeStopAction(action as AutomationActionStop);
  }

  private isSchemaValue(value: unknown): value is StateSchema | StateNumSchema {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const schemaKeys = [
      'data',
      'mask',
      'offset',
      'inverted',
      'guard',
      'except',
      'length',
      'precision',
      'signed',
      'endian',
      'decode',
      'mapping',
    ];
    return schemaKeys.some((key) => key in (value as Record<string, unknown>));
  }

  private mapStateKey(key: string): string {
    const mapping: Record<string, string> = {
      temperature_target: 'target_temperature',
      temperature_current: 'current_temperature',
      humidity_target: 'target_humidity',
      humidity_current: 'current_humidity',
    };
    const normalized = key.startsWith('state_') ? key.replace('state_', '') : key;
    return mapping[normalized] ?? normalized;
  }

  private getAllowedUpdateStateKeys(entity: Record<string, any>) {
    const allowedKeys = new Set<string>();

    if (entity.state) {
      allowedKeys.add('state');
    }

    for (const key of Object.keys(entity)) {
      if (!key.startsWith('state_')) continue;
      allowedKeys.add(key);
      allowedKeys.add(this.mapStateKey(key));
    }

    if (entity.state_on || entity.state_off) {
      allowedKeys.add('on');
      allowedKeys.add('off');
      allowedKeys.add('state');
    }

    return allowedKeys;
  }

  private isDataMatchSchema(schema: StateSchema | StateNumSchema) {
    const hasNumericFields =
      'length' in schema ||
      'decode' in schema ||
      'precision' in schema ||
      'signed' in schema ||
      'mapping' in schema ||
      'endian' in schema;
    return (
      Array.isArray(schema.data) &&
      schema.data.length > 0 &&
      !hasNumericFields
    );
  }

  private async executeUpdateStateAction(
    action: AutomationActionUpdateState,
    context: TriggerContext,
  ) {
    if (!this.stateManager) {
      logger.warn('[automation] update_state action requires StateManager');
      return;
    }

    const entity = findEntityById(this.config, action.target_id);
    if (!entity) {
      throw new Error(`[automation] update_state 대상 엔티티를 찾을 수 없습니다: ${action.target_id}`);
    }

    const allowedKeys = this.getAllowedUpdateStateKeys(entity as Record<string, any>);
    for (const key of Object.keys(action.state)) {
      if (!allowedKeys.has(key)) {
        throw new Error(
          `[automation] update_state 대상 엔티티에 정의되지 않은 속성입니다: ${action.target_id}.${key}`,
        );
      }
    }

    const headerLength = this.config.packet_defaults?.rx_header?.length || 0;
    const payload = context.packet ? Buffer.from(context.packet).slice(headerLength) : null;
    const requiresPacket = Object.values(action.state).some((value) => {
      return this.isSchemaValue(value);
    });
    if (!payload && requiresPacket) {
      logger.warn({ action }, '[automation] update_state requires packet context');
    }
    const updates: Record<string, any> = {};

    for (const [key, rawValue] of Object.entries(action.state)) {
      const mappedKey = this.mapStateKey(key);
      if (this.isSchemaValue(rawValue)) {
        if (!payload) continue;
        if (this.isDataMatchSchema(rawValue)) {
          const matched = matchesPacket(rawValue, payload, {
            allowEmptyData: true,
            context: this.buildContext(context),
          });
          updates[mappedKey] = matched;
          continue;
        }
        const extracted = extractFromSchema(payload, rawValue);
        if (extracted === null || extracted === undefined) {
          continue;
        }
        updates[mappedKey] = extracted;
      } else {
        updates[mappedKey] = rawValue as AutomationActionUpdateStateValue;
      }
    }

    if (Object.keys(updates).length === 0) {
      logger.debug(
        { action },
        '[automation] update_state action skipped: no matched updates',
      );
      return;
    }

    const stateFlags: Array<{ key: string; value: 'ON' | 'OFF' }> = [
      { key: 'state_on', value: 'ON' },
      { key: 'state_off', value: 'OFF' },
      { key: 'on', value: 'ON' },
      { key: 'off', value: 'OFF' },
    ];

    for (const { key, value } of stateFlags) {
      if (typeof updates[key] === 'boolean') {
        if (updates[key]) {
          updates.state = value;
        }
        delete updates[key];
      }
    }

    this.stateManager.updateEntityState(action.target_id, updates);
  }

  private async executeSendPacketAction(
    action: AutomationActionSendPacket,
    context: TriggerContext,
    automationPortId?: string,
    scriptStack: string[] = [],
    automationId?: string,
  ) {
    let packetData: number[] = [];

    if (Array.isArray(action.data)) {
      packetData = [...action.data];
    } else if (typeof action.data === 'string') {
      // Evaluate CEL
      const result = this.celExecutor.execute(action.data, this.buildContext(context));
      if (Array.isArray(result)) {
        packetData = result.map((n) => Number(n));
      } else {
        logger.warn(
          { action, result },
          '[automation] send_packet CEL expression must return number array',
        );
        return;
      }
    } else {
      logger.warn({ action }, '[automation] send_packet data invalid type');
      return;
    }

    const defaults = this.config.packet_defaults || {};

    // 1. Prepare Header
    let header: number[] = [];
    if (Array.isArray(action.header)) {
      header = action.header;
    } else if (action.header === true) {
      header = defaults.tx_header || [];
    }

    // 2. Prepare Footer
    let footer: number[] = [];
    if (Array.isArray(action.footer)) {
      footer = action.footer;
    } else if (action.footer === true) {
      footer = defaults.tx_footer || [];
    }

    // 3. Assemble Body (Header + Data)
    // Checksum usually covers header + data.
    const packetWithHeader = [...header, ...packetData];

    // 4. Append Checksum if requested (default true)
    if (action.checksum !== false) {
      const checksumType = defaults.tx_checksum;
      const checksum2Type = defaults.tx_checksum2;
      const buffer = Buffer.from(packetWithHeader);

      if (checksumType && checksumType !== 'none') {
        if (typeof checksumType === 'string') {
          const cs = calculateChecksumFromBuffer(
            buffer,
            checksumType as ChecksumType,
            0,
            packetWithHeader.length,
          );
          packetWithHeader.push(cs);
        }
      } else if (checksum2Type) {
        if (typeof checksum2Type === 'string') {
          const cs = calculateChecksum2FromBuffer(
            buffer,
            checksum2Type as Checksum2Type,
            0,
            packetWithHeader.length,
          );
          packetWithHeader.push(cs[0], cs[1]);
        }
      }
    }

    // 5. Append Footer
    const finalPacket = [...packetWithHeader, ...footer];

    const targetPortId = action.portId || automationPortId || this.contextPortId;
    const hexPacket = Buffer.from(finalPacket).toString('hex');

    // Determine source name (script > automation > generic)
    let sourceName = 'send_packet';
    if (scriptStack.length > 0) {
      sourceName = `script:${scriptStack[0]}`;
    } else if (automationId) {
      sourceName = `automation:${automationId}`;
    }

    // Emit command-packet event for packet log display
    eventBus.emit('command-packet', {
      entity: sourceName,
      entityId: sourceName,
      command: 'send_packet',
      value: undefined,
      packet: hexPacket,
      portId: targetPortId,
      timestamp: new Date().toISOString(),
    });

    if (this.commandSender) {
      // ack가 배열로 입력된 경우 StateSchema 형태로 변환하여 호환성 확보
      const ackMatch = Array.isArray(action.ack) ? { data: action.ack } : action.ack;

      await this.commandSender(targetPortId, finalPacket, {
        ackMatch,
      });
    } else {
      logger.warn(
        '[automation] send_packet action cannot be executed: commandSender not available',
      );
    }
  }

  private async executeCommandAction(
    action: AutomationActionCommand,
    context: TriggerContext,
    scriptStack: string[] = [],
  ) {
    const parsed = this.parseCommandTarget(action.target, action.input);
    if (!parsed) return;

    const entity = findEntityById(this.config, parsed.entityId);
    if (!entity) {
      logger.warn({ target: action.target }, '[automation] Entity not found for command');
      return;
    }

    const { normalized, schema } = this.getCommandSchema(entity, parsed.command);

    if (schema && typeof schema === 'object' && (schema as any).script) {
      await this.runScript((schema as any).script, context, scriptStack);
      return;
    }

    const commandResult = this.packetProcessor.constructCommandPacket(
      entity,
      normalized,
      parsed.value,
    );
    if (!commandResult) {
      logger.warn({ target: action.target }, '[automation] Failed to construct command packet');
      return;
    }

    // Extract packet and ack from result (can be number[] or CommandResult)
    let packet: number[];
    let celAck: StateSchema | undefined;

    if (Array.isArray(commandResult)) {
      packet = commandResult;
    } else {
      // CommandResult with { packet, ack }
      packet = commandResult.packet;
      celAck = commandResult.ack;
    }

    let isLowPriority = action.low_priority;
    if (isLowPriority === undefined) {
      const schemaLowPriority =
        schema && typeof schema === 'object' ? (schema as any).low_priority : undefined;
      if (schemaLowPriority) isLowPriority = true;
    }

    // Determine ackMatch: CEL result ack takes priority, then schema ack
    let ackMatch: StateSchema | undefined = celAck;
    if (!ackMatch && schema && typeof schema === 'object') {
      const ack = (schema as any).ack;
      if (ack) {
        ackMatch = Array.isArray(ack) ? { data: ack } : ack;
      }
    }

    await this.commandManager.send(entity, packet, {
      priority: isLowPriority ? 'low' : 'normal',
      ackMatch,
    });
  }

  private async executePublishAction(action: AutomationActionPublish, context: TriggerContext) {
    const payload =
      typeof action.payload === 'string' ? action.payload : JSON.stringify(action.payload);
    this.mqttPublisher.publish(action.topic, payload, action.retain ? { retain: true } : undefined);
  }

  private async executeLogAction(action: AutomationActionLog, context: TriggerContext) {
    const level = action.level || 'info';
    logger[level]({ trigger: context.type }, `[automation] ${action.message}`);
  }

  private async executeDelayAction(action: AutomationActionDelay, signal?: AbortSignal) {
    const duration = parseDuration(action.milliseconds as any) ?? 0;
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(resolve, duration);
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeoutId);
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
          return;
        }
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeoutId);
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true },
        );
      }
    });
  }

  private async executeScriptAction(
    action: AutomationActionScript,
    context: TriggerContext,
    scriptStack: string[],
  ) {
    if (action.script) {
      await this.runScript(action.script, context, scriptStack);
      return;
    }

    if (action.code) {
      logger.warn('[automation] Script code 실행은 지원되지 않습니다. script ID를 사용하세요.');
      return;
    }

    logger.warn('[automation] script action에 실행할 script가 지정되지 않았습니다.');
  }

  private parseCommandTarget(
    target: string,
    input: any,
  ): { entityId: string; command: string; value?: any } | null {
    const callPattern = /^id\(([^)]+)\)\.command_([^(]+)\((.*)\)$/;
    const match = target.match(callPattern);
    if (match) {
      const [, entityId, command, rawValue] = match;
      const trimmed = rawValue.trim();
      const value = input !== undefined ? input : this.parseValue(trimmed);
      return { entityId, command, value };
    }
    logger.warn({ target }, '[automation] Unsupported command target format');
    return null;
  }

  private parseValue(raw: string) {
    if (!raw) return undefined;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const num = Number(raw);
    if (!Number.isNaN(num)) return num;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  private async executeIfAction(
    action: AutomationActionIf,
    context: TriggerContext,
    automationPortId?: string,
    scriptStack: string[] = [],
    signal?: AbortSignal,
  ) {
    const conditionResult = this.celExecutor.execute(action.condition, this.buildContext(context));
    const actions = Boolean(conditionResult) ? action.then : action.else;

    if (!actions || actions.length === 0) return;

    for (const subAction of actions) {
      if (signal?.aborted) return;
      await this.executeAction(subAction, context, automationPortId, scriptStack, signal);
    }
  }

  private async executeRepeatAction(
    action: AutomationActionRepeat,
    context: TriggerContext,
    automationPortId?: string,
    scriptStack: string[] = [],
    signal?: AbortSignal,
  ) {
    const DEFAULT_MAX_ITERATIONS = 100;

    // Fixed count loop
    if (action.count !== undefined) {
      const count = Math.max(0, Math.min(action.count, DEFAULT_MAX_ITERATIONS));
      for (let i = 0; i < count; i++) {
        if (signal?.aborted) return;
        for (const subAction of action.actions) {
          if (signal?.aborted) return;
          await this.executeAction(subAction, context, automationPortId, scriptStack, signal);
        }
      }
      return;
    }

    // While loop (condition-based)
    if (action.while) {
      const maxIterations = action.max ?? DEFAULT_MAX_ITERATIONS;
      if (maxIterations <= 0) {
        logger.warn('[automation] repeat while loop requires max > 0');
        return;
      }

      let iterations = 0;
      while (iterations < maxIterations) {
        if (signal?.aborted) return;

        const conditionResult = this.celExecutor.execute(action.while, this.buildContext(context));
        if (!Boolean(conditionResult)) break;

        for (const subAction of action.actions) {
          if (signal?.aborted) return;
          await this.executeAction(subAction, context, automationPortId, scriptStack, signal);
        }
        iterations++;
      }

      if (iterations >= maxIterations) {
        logger.warn(
          { iterations, max: maxIterations },
          '[automation] repeat while loop reached max iterations',
        );
      }
      return;
    }

    logger.warn('[automation] repeat action requires either count or while');
  }

  private async executeWaitUntilAction(
    action: AutomationActionWaitUntil,
    context: TriggerContext,
    signal?: AbortSignal,
  ) {
    const DEFAULT_TIMEOUT = 30000; // 30 seconds
    const DEFAULT_CHECK_INTERVAL = 100; // 100ms

    const timeout = parseDuration(action.timeout as any) ?? DEFAULT_TIMEOUT;
    const checkInterval = parseDuration(action.check_interval as any) ?? DEFAULT_CHECK_INTERVAL;
    const startTime = Date.now();

    logger.debug(
      { condition: action.condition, timeout, checkInterval },
      '[automation] wait_until started',
    );

    while (true) {
      // Check abort signal
      if (signal?.aborted) {
        logger.debug('[automation] wait_until aborted');
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      }

      // Check condition
      const conditionResult = this.celExecutor.execute(
        action.condition,
        this.buildContext(context),
      );
      if (Boolean(conditionResult)) {
        logger.debug('[automation] wait_until condition met');
        return;
      }

      // Check timeout
      if (Date.now() - startTime >= timeout) {
        logger.warn({ condition: action.condition, timeout }, '[automation] wait_until timed out');
        return;
      }

      // Wait for check interval
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(resolve, checkInterval);
        if (signal) {
          if (signal.aborted) {
            clearTimeout(timeoutId);
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timeoutId);
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        }
      });
    }
  }

  private async executeChooseAction(
    action: AutomationActionChoose,
    context: TriggerContext,
    automationPortId?: string,
    scriptStack: string[] = [],
    signal?: AbortSignal,
  ) {
    // Find the first choice whose condition evaluates to true
    for (const choice of action.choices) {
      if (signal?.aborted) return;

      const conditionResult = this.celExecutor.execute(
        choice.condition,
        this.buildContext(context),
      );
      if (Boolean(conditionResult)) {
        logger.debug({ condition: choice.condition }, '[automation] choose: condition matched');
        for (const subAction of choice.then) {
          if (signal?.aborted) return;
          await this.executeAction(subAction, context, automationPortId, scriptStack, signal);
        }
        return; // Stop after first matching choice
      }
    }

    // No choice matched, execute default if provided
    if (action.default && action.default.length > 0) {
      logger.debug('[automation] choose: no condition matched, executing default');
      for (const subAction of action.default) {
        if (signal?.aborted) return;
        await this.executeAction(subAction, context, automationPortId, scriptStack, signal);
      }
    }
  }

  private async executeStopAction(action: AutomationActionStop): Promise<never> {
    const reason = action.reason || 'stop action executed';
    logger.debug({ reason }, '[automation] Stopping automation');

    // Throw a special error to stop the automation
    const error = new Error(reason);
    error.name = 'StopActionError';
    throw error;
  }

  private buildContext(context: TriggerContext) {
    const stateSnapshot: Record<string, any> = {};
    for (const [key, value] of this.states.entries()) {
      stateSnapshot[key] = value;
    }

    // CEL context: simple data
    return {
      states: stateSnapshot, // access as states['entity_id']['property']
      trigger: context,
      timestamp: Date.now(),
      // 'id' and 'command' helpers removed as they are functions
    };
  }
}
