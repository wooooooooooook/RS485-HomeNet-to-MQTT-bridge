import parser from 'cron-parser';
import { EventEmitter } from 'node:events';

import type {
  AutomationAction,
  AutomationActionCommand,
  AutomationActionDelay,
  AutomationActionLog,
  AutomationActionPublish,
  AutomationActionSendPacket,
  AutomationConfig,
  AutomationGuard,
  AutomationTrigger,
  AutomationTriggerPacket,
  AutomationTriggerSchedule,
  AutomationTriggerState,
  HomenetBridgeConfig,
} from '../config/types.js';
import type { StateSchema } from '../protocol/types.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { CelExecutor } from '../protocol/cel-executor.js';
import { CommandManager } from '../service/command.manager.js';
import { eventBus } from '../service/event-bus.js';
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

interface TriggerContext {
  type: AutomationTrigger['type'];
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
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly subscriptions: {
    emitter: EventEmitter;
    event: string;
    handler: (...args: any[]) => void;
  }[] = [];
  private readonly states = new Map<string, Record<string, any>>();
  private readonly scripts = new Map<string, AutomationAction[]>();
  private isStarted = false;

  constructor(
    private readonly config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    commandManager: CommandManager,
    mqttPublisher: MqttPublisher,
    private readonly contextPortId?: string,
    private readonly commandSender?: CommandSender,
  ) {
    this.automationList = (config.automation || []).filter(
      (automation) => automation.enabled !== false,
    );
    if (config.script) {
      for (const script of config.script) {
        this.scripts.set(script.id, script.then);
      }
    }
    this.packetProcessor = packetProcessor;
    this.commandManager = commandManager;
    this.mqttPublisher = mqttPublisher;

    // Register CEL functions (exceptions to "pure function" rule)
    // IMPORTANT: When testing with vitest mocks, logger might be a spy object.
    // We bind directly to the logger instance to allow mocking in tests.
    this.celExecutor.registerFunction('log(string): bool', (message: string) => {
      logger.info({ context: 'CEL' }, `[automation] ${message}`);
      return true;
    });

    this.celExecutor.registerFunction(
      'command(string, string, dyn): bool',
      (entityId: string, command: string, value: any) => {
        // Run command execution in background
        // Use setImmediate or nextTick logic if strictly needed, but here we just fire and forget.
        // We catch the promise to avoid unhandled rejections.
        this.runCommandFromCel(entityId, command, value).catch((err) => {
          logger.error({ error: err }, '[automation] CEL command failed');
        });
        return true;
      },
    );
  }

  private async runCommandFromCel(entityId: string, command: string, value: any) {
    const entity = findEntityById(this.config, entityId);
    if (!entity) {
      logger.warn({ entityId }, '[automation] CEL command: Entity not found');
      return;
    }
    // Handle BigInt from CEL
    const safeValue = typeof value === 'bigint' ? Number(value) : value;

    const packetOrScript = this.packetProcessor.constructCommandPacket(entity, command, safeValue);
    if (!packetOrScript) {
      logger.warn({ entityId, command }, '[automation] CEL command: Failed to construct packet');
      return;
    }

    if (!Array.isArray(packetOrScript) && 'type' in packetOrScript && packetOrScript.type === 'script') {
       await this.runScript(packetOrScript.id);
       return;
    }

    await this.commandManager.send(entity, packetOrScript as number[]);
  }

  public addAutomation(config: AutomationConfig) {
    this.automationList.push(config);
  }

  public removeAutomation(id: string) {
    const index = this.automationList.findIndex((a) => a.id === id);
    if (index !== -1) {
      this.automationList.splice(index, 1);
    }
  }

  public async runScript(id: string, data?: any) {
    const actions = this.scripts.get(id);
    if (!actions) {
      logger.warn({ scriptId: id }, '[automation] Script not found');
      return;
    }

    const context: TriggerContext = {
      type: 'script' as any, // Virtual trigger type
      timestamp: Date.now(),
      state: data || {},
    };

    logger.info({ scriptId: id }, '[automation] Running script');
    for (const action of actions) {
      try {
        await this.executeAction(action, context, this.contextPortId);
      } catch (error) {
        logger.error({ error, scriptId: id, action: action.action }, '[automation] Script action failed');
      }
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

    const packetListener = (packet: number[]) => this.handlePacketTriggers(packet);
    this.bind(this.packetProcessor, 'packet', packetListener);

    for (const automation of this.automationList) {
      for (const trigger of automation.trigger) {
        if (trigger.type === 'schedule') {
          this.setupScheduleTrigger(automation, trigger);
        }
        if (trigger.type === 'startup') {
          // Immediately schedule execution (to avoid blocking sync flow)
          setTimeout(
            () =>
              this.runAutomation(automation, trigger, { type: 'startup', timestamp: Date.now() }),
            0,
          );
        }
      }
    }
  }

  stop() {
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.length = 0;
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
      this.timers.push(interval);
    }

    if (trigger.cron) {
      try {
        const cron = parser.parseExpression(trigger.cron, { utc: true });
        const scheduleNext = () => {
          const next = cron.next().toDate();
          const delay = Math.max(0, next.getTime() - Date.now());
          const timeout = setTimeout(() => {
            this.runAutomation(automation, trigger, { type: 'schedule', timestamp: Date.now() });
            scheduleNext();
          }, delay);
          this.timers.push(timeout);
        };
        scheduleNext();
      } catch (error) {
        logger.error({ error, cron: trigger.cron }, '[automation] Invalid cron expression');
      }
    }
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

  private handlePacketTriggers(packet: number[]) {
    for (const automation of this.automationList) {
      for (const trigger of automation.trigger) {
        if (trigger.type !== 'packet') continue;
        const context: TriggerContext = { type: 'packet', packet, timestamp: Date.now() };
        if (!this.matchesPacket(trigger, packet)) continue;
        this.runAutomation(automation, trigger, context);
      }
    }
  }

  private matchesPacket(trigger: AutomationTriggerPacket, packet: number[]) {
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
    const guardResult =
      this.evaluateGuard(trigger.guard, context) && this.evaluateGuard(automation.guard, context);
    const actions = guardResult ? automation.then : automation.else;
    if (!actions || actions.length === 0) return;

    logger.info({ automation: automation.id, trigger: trigger.type }, '[automation] Executing');
    for (const action of actions) {
      try {
        await this.executeAction(action, context, automation.portId);
      } catch (error) {
        logger.error(
          { error, automation: automation.id, action: action.action },
          '[automation] Action failed',
        );
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
  ) {
    if (action.action === 'command') return this.executeCommandAction(action, context);
    if (action.action === 'publish') return this.executePublishAction(action, context);
    if (action.action === 'log')
      return this.executeLogAction(action as AutomationActionLog, context);
    if (action.action === 'delay') return this.executeDelayAction(action as AutomationActionDelay);
    if (action.action === 'script') return this.executeScriptAction(action, context);
    if (action.action === 'run_script')
      return this.executeRunScriptAction(action as any, context, automationPortId);
    if (action.action === 'send_packet')
      return this.executeSendPacketAction(
        action as AutomationActionSendPacket,
        context,
        automationPortId,
      );
  }

  private async executeSendPacketAction(
    action: AutomationActionSendPacket,
    context: TriggerContext,
    automationPortId?: string,
  ) {
    let packetData: number[] = [];

    if (Array.isArray(action.data)) {
      packetData = action.data;
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

    // Append Checksum if requested (default true)
    if (action.checksum !== false) {
      const defaults = this.config.packet_defaults || {};
      const checksumType = defaults.tx_checksum;
      const checksum2Type = defaults.tx_checksum2;
      const buffer = Buffer.from(packetData);

      if (checksumType && checksumType !== 'none') {
        if (typeof checksumType === 'string') {
          const cs = calculateChecksumFromBuffer(
            buffer,
            checksumType as ChecksumType,
            0,
            packetData.length,
          );
          packetData.push(cs);
        }
      } else if (checksum2Type) {
        if (typeof checksum2Type === 'string') {
          const cs = calculateChecksum2FromBuffer(
            buffer,
            checksum2Type as Checksum2Type,
            0,
            packetData.length,
          );
          packetData.push(cs[0], cs[1]);
        }
      }
    }

    const targetPortId = action.portId || automationPortId || this.contextPortId;

    if (this.commandSender) {
      await this.commandSender(targetPortId, packetData, {
        ackMatch: action.ack,
      });
    } else {
      logger.warn(
        '[automation] send_packet action cannot be executed: commandSender not available',
      );
    }
  }

  private async executeCommandAction(action: AutomationActionCommand, context: TriggerContext) {
    const parsed = this.parseCommandTarget(action.target, action.input);
    if (!parsed) return;

    const entity = findEntityById(this.config, parsed.entityId);
    if (!entity) {
      logger.warn({ target: action.target }, '[automation] Entity not found for command');
      return;
    }

    const packetOrScript = this.packetProcessor.constructCommandPacket(
      entity,
      parsed.command,
      parsed.value,
    );
    if (!packetOrScript) {
      logger.warn({ target: action.target }, '[automation] Failed to construct command packet');
      return;
    }

    if (!Array.isArray(packetOrScript) && 'type' in packetOrScript && packetOrScript.type === 'script') {
      await this.runScript(packetOrScript.id);
      return;
    }

    const packet = packetOrScript as number[];

    let isLowPriority = action.low_priority;
    if (isLowPriority === undefined) {
      const commandKey = `command_${parsed.command}`;
      const schema = (entity as any)[commandKey];
      if (schema && typeof schema === 'object' && schema.low_priority) {
        isLowPriority = true;
      }
    }

    await this.commandManager.send(entity, packet, {
      priority: isLowPriority ? 'low' : 'normal',
    });
  }

  private async executeRunScriptAction(
    action: { action: 'run_script'; id: string; data?: any },
    context: TriggerContext,
    automationPortId?: string,
  ) {
    await this.runScript(action.id, action.data);
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

  private async executeDelayAction(action: AutomationActionDelay) {
    const duration = parseDuration(action.milliseconds as any) ?? 0;
    await new Promise((resolve) => setTimeout(resolve, duration));
  }

  private async executeScriptAction(action: { code: string }, context: TriggerContext) {
    logger.warn(
      '[automation] Script action is not supported with CEL executor (no side effects). Ignoring.',
    );
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
