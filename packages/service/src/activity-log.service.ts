import { eventBus } from '@rs485-homenet/core';

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

  constructor() {
    this.subscribeToEvents();
    setInterval(() => this.cleanupOldLogs(), 60 * 60 * 1000); // Cleanup every hour
  }

  private subscribeToEvents() {
    eventBus.on('state:changed', (event) => {
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

    eventBus.on('mqtt-message', (event) => {
      if (event.topic.endsWith('/set')) {
        this.addLog(
          'log.command_received',
          {
            topic: event.topic,
            message: event.message,
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
  }

  public addLog(code: string, params: Record<string, any> = {}, portId?: string): void {
    const logEntry: ActivityLog = {
      timestamp: Date.now(),
      code,
      params,
      portId,
    };
    this.logs.push(logEntry); // Add to the end of the array
    eventBus.emit('activity-log:added', logEntry);
    this.cleanupOldLogs();
  }

  public getRecentLogs(): ActivityLog[] {
    return this.logs;
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
}

export const activityLogService = new ActivityLogService();
