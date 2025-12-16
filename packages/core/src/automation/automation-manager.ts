import parser from 'cron-parser';
import { EventEmitter } from 'node:events';

import type {
  AutomationAction,
  AutomationActionCommand,
  AutomationActionDelay,
  AutomationActionLog,
  AutomationActionPublish,
  AutomationConfig,
  AutomationGuard,
  AutomationTrigger,
  AutomationTriggerPacket,
  AutomationTriggerSchedule,
  AutomationTriggerState,
  HomenetBridgeConfig,
  LambdaConfig,
} from '../config/types.js';
import type { StateSchema } from '../protocol/types.js';
import { PacketProcessor } from '../protocol/packet-processor.js';
import { LambdaExecutor } from '../protocol/lambda-executor.js';
import { CommandManager } from '../service/command.manager.js';
import { eventBus } from '../service/event-bus.js';
import { MqttPublisher } from '../transports/mqtt/publisher.js';
import { parseDuration } from '../utils/duration.js';
import { findEntityById } from '../utils/entities.js';
import { logger } from '../utils/logger.js';

interface TriggerContext {
  type: AutomationTrigger['type'];
  state?: Record<string, any>;
  packet?: number[];
  timestamp: number;
}

export class AutomationManager {
  private readonly automationList: AutomationConfig[];
  private readonly packetProcessor: PacketProcessor;
  private readonly commandManager: CommandManager;
  private readonly mqttPublisher: MqttPublisher;
  private readonly lambdaExecutor = new LambdaExecutor();
  private readonly debounceTracker = new Map<string, number>();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly subscriptions: { emitter: EventEmitter; event: string; handler: (...args: any[]) => void }[] = [];
  private readonly states = new Map<string, Record<string, any>>();
  private isStarted = false;

  constructor(
    private readonly config: HomenetBridgeConfig,
    packetProcessor: PacketProcessor,
    commandManager: CommandManager,
    mqttPublisher: MqttPublisher,
  ) {
    this.automationList = (config.automation || []).filter((automation) => automation.enabled !== false);
    this.packetProcessor = packetProcessor;
    this.commandManager = commandManager;
    this.mqttPublisher = mqttPublisher;
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

  start() {
    if (this.isStarted) return;
    this.isStarted = true;

    const stateListener = ({ entityId, state }: { entityId: string; state: Record<string, any> }) => {
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
          setTimeout(() =>
            this.runAutomation(automation, trigger, { type: 'startup', timestamp: Date.now() }), 0);
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

  private setupScheduleTrigger(
    automation: AutomationConfig,
    trigger: AutomationTriggerSchedule,
  ) {
    if (!trigger.every_ms && !trigger.cron) {
      logger.warn({ automation: automation.id }, '[automation] schedule trigger missing interval or cron');
      return;
    }

    const every = trigger.every_ms !== undefined ? parseDuration(trigger.every_ms as any) : undefined;

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
    const match = trigger.match as StateSchema;
    if (!match.data || !Array.isArray(match.data)) return false;
    const offset = match.offset ?? 0;
    let matched = true;
    for (let i = 0; i < match.data.length; i++) {
      const expected = match.data[i];
      const packetByte = packet[offset + i];
      if (packetByte === undefined) {
        matched = false;
        break;
      }
      const mask = Array.isArray(match.mask) ? match.mask[i] : match.mask;
      const maskedPacket = mask !== undefined ? packetByte & mask : packetByte;
      const maskedExpected = mask !== undefined ? expected & mask : expected;
      if (maskedPacket !== maskedExpected) {
        matched = false;
        break;
      }
    }
    return match.inverted ? !matched : matched;
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
        await this.executeAction(action, context);
      } catch (error) {
        logger.error({ error, automation: automation.id, action: action.action }, '[automation] Action failed');
      }
    }
  }

  private evaluateGuard(guard: AutomationGuard | undefined, context: TriggerContext) {
    if (!guard) return true;
    const lambda: LambdaConfig =
      typeof guard === 'string'
        ? { type: 'lambda', script: guard.trim().startsWith('return') ? guard : `return ${guard}` }
        : guard;

    const result = this.lambdaExecutor.execute(lambda, this.buildContext(context));
    return Boolean(result);
  }

  private async executeAction(action: AutomationAction, context: TriggerContext) {
    if (action.action === 'command') return this.executeCommandAction(action, context);
    if (action.action === 'publish') return this.executePublishAction(action, context);
    if (action.action === 'log') return this.executeLogAction(action as AutomationActionLog, context);
    if (action.action === 'delay') return this.executeDelayAction(action as AutomationActionDelay);
    if (action.action === 'script') return this.executeScriptAction(action, context);
  }

  private async executeCommandAction(action: AutomationActionCommand, context: TriggerContext) {
    const parsed = this.parseCommandTarget(action.target, action.input);
    if (!parsed) return;

    const entity = findEntityById(this.config, parsed.entityId);
    if (!entity) {
      logger.warn({ target: action.target }, '[automation] Entity not found for command');
      return;
    }

    const packet = this.packetProcessor.constructCommandPacket(entity, parsed.command, parsed.value);
    if (!packet) {
      logger.warn({ target: action.target }, '[automation] Failed to construct command packet');
      return;
    }

    await this.commandManager.send(entity, packet);
  }

  private async executePublishAction(action: AutomationActionPublish, context: TriggerContext) {
    const payload = typeof action.payload === 'string' ? action.payload : JSON.stringify(action.payload);
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

  private async executeScriptAction(action: { code: AutomationGuard }, context: TriggerContext) {
    const lambda: LambdaConfig =
      typeof action.code === 'string'
        ? { type: 'lambda', script: action.code }
        : (action.code as LambdaConfig);
    this.lambdaExecutor.execute(lambda, this.buildContext(context));
  }

  private parseCommandTarget(target: string, input: any):
    | { entityId: string; command: string; value?: any }
    | null {
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

    const id = (entityId: string) =>
      new Proxy(stateSnapshot[entityId] || {}, {
        get: (target, prop) => {
          if (typeof prop === 'string' && prop.startsWith('command_')) {
            const command = prop.replace('command_', '');
            return (value?: any) =>
              this.executeCommandAction(
                { action: 'command', target: `id(${entityId}).command_${command}()`, input: value },
                context,
              );
          }
          return target[prop as keyof typeof target];
        },
      });

    return {
      id,
      states: stateSnapshot,
      trigger: context,
      timestamp: Date.now(),
      command: (entityId: string, command: string, value?: any) =>
        this.executeCommandAction(
          { action: 'command', target: `id(${entityId}).command_${command}()`, input: value },
          context,
        ),
      publish: (topic: string, payload: any, retain?: boolean) =>
        this.executePublishAction({ action: 'publish', topic, payload, retain }, context),
    };
  }
}
