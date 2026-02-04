import {
  eventBus,
  type StateChangedEvent,
  type MqttMessageEvent,
  type AutomationGuardEvent,
  type AutomationActionEvent,
  type ScriptActionEvent,
} from '@rs485-homenet/core';

export interface ActivityLog {
  timestamp: number;
  code: string;
  params?: Record<string, any>;
  // Optional fallback message for legacy or non-i18n clients
  message?: string;
  portId?: string;
}

const LOG_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const MAX_LOGS = 1000;

const formatStateValue = (value: unknown): string => {
  if (value === null || typeof value === 'undefined') {
    return 'N/A';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

export class ActivityLogService {
  private logs: ActivityLog[] = [];
  private pendingLogs: ActivityLog[] = [];
  private flushScheduled = false;
  private isEnabledCallback: (() => boolean) | null = null;

  constructor() {
    this.subscribeToEvents();
    setInterval(() => this.cleanupOldLogs(), 60 * 60 * 1000); // Cleanup every hour
  }

  /**
   * Set a callback to check if caching is enabled.
   * If not set, logs will always be stored.
   */
  public setEnabledCallback(callback: () => boolean) {
    this.isEnabledCallback = callback;
  }

  private isEnabled(): boolean {
    return this.isEnabledCallback ? this.isEnabledCallback() : true;
  }

  private subscribeToEvents() {
    eventBus.on('state:changed', (event: StateChangedEvent) => {
      if (!event.changes || typeof event.changes !== 'object') return;

      Object.entries(event.changes).forEach(([key, value]) => {
        const oldValue = event.oldState ? event.oldState[key] : undefined;
        // If value hasn't changed, skip logging (though typically PacketProcessor emits only changes)
        if (oldValue === value) return;

        const from = formatStateValue(oldValue);
        const to = formatStateValue(value);

        this.addLog(
          'log.state_change',
          {
            entityId: event.entityId,
            attribute: key,
            from,
            to,
          },
          event.portId,
        );
      });
    });

    eventBus.on('mqtt-message', (event: MqttMessageEvent) => {
      if (event.topic.endsWith('/set')) {
        this.addLog(
          'log.command_received',
          {
            topic: event.topic,
            message: event.payload,
          },
          undefined, // portId unknown here usually
        );
      }
    });

    eventBus.on('core:started', () => {
      this.addLog('log.core_started');
    });

    eventBus.on('core:stopped', () => {
      this.addLog('log.core_stopped');
    });

    eventBus.on('automation:guard', (event: AutomationGuardEvent) => {
      if (!event.result) {
        // Only log when guard fails
        this.addLog(
          'log.automation_run_guard_failed',
          {
            automationId: event.automationId,
            trigger: event.triggerType,
          },
          event.portId,
        );
      }
    });

    eventBus.on('automation:action', (event: AutomationActionEvent) => {
      const isFirst = event.actionIndex === 0 || event.actionIndex === undefined;
      const code = isFirst
        ? 'log.automation_run_action_executed'
        : 'log.automation_consecutive_action_executed';

      this.addLog(
        code,
        {
          automationId: event.automationId,
          trigger: event.triggerType,
          action: event.action,
        },
        event.portId,
      );
    });

    eventBus.on('script:action', (event: ScriptActionEvent) => {
      this.addLog(
        'log.script_action_executed',
        {
          scriptId: event.scriptId,
          action: event.action,
          sourceEntityId: event.sourceEntityId,
        },
        event.portId,
      );
    });
  }

  public addLog(code: string, params: Record<string, any> = {}, portId?: string): void {
    const logEntry: ActivityLog = {
      timestamp: Date.now(),
      code,
      params,
      portId,
    };
    this.pendingLogs.push(logEntry);
    this.scheduleFlush();
  }

  public getRecentLogs(): ActivityLog[] {
    if (this.pendingLogs.length > 0) {
      this.flushPendingLogs();
    }
    return this.logs;
  }

  public clearLogs(): void {
    this.logs = [];
  }

  private cleanupOldLogs(): void {
    const now = Date.now();
    const cutoff = now - LOG_TTL;
    const originalCount = this.logs.length;

    // Filter by TTL
    this.logs = this.logs.filter((log) => log.timestamp >= cutoff);
    const ttlRemoved = originalCount - this.logs.length;

    // Filter by Size
    if (this.logs.length > MAX_LOGS) {
      this.logs = this.logs.slice(this.logs.length - MAX_LOGS);
    }

    if (ttlRemoved > 0) {
      // Log removed
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setImmediate(() => this.flushPendingLogs());
  }

  private flushPendingLogs(): void {
    this.flushScheduled = false;
    if (this.pendingLogs.length === 0) return;

    const logsToFlush = this.pendingLogs;
    this.pendingLogs = [];

    for (const logEntry of logsToFlush) {
      eventBus.emit('activity-log:added', logEntry);
    }

    if (!this.isEnabled()) return;

    this.logs.push(...logsToFlush);
    if (this.logs.length > MAX_LOGS) {
      this.cleanupOldLogs();
    }
  }
}

export const activityLogService = new ActivityLogService();
