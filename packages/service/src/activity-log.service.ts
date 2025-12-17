import { eventBus } from '@rs485-homenet/core';

interface ActivityLog {
  timestamp: number;
  message: string;
  details?: any;
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
          `${event.entityId} 상태 변경: ${key} ${from} → ${to}`,
          {
            attribute: key,
            from: oldValue,
            to: value,
          },
          event.portId,
        );
      });
    });

    eventBus.on('mqtt-message', (event) => {
      if (event.topic.endsWith('/set')) {
        this.addLog(`명령 수신: ${event.topic}`, event.message);
      }
    });

    eventBus.on('core:started', () => {
      this.addLog('코어 서비스가 시작되었습니다.');
    });

    eventBus.on('core:stopped', () => {
      this.addLog('코어 서비스가 중지되었습니다.');
    });
  }

  public addLog(message: string, details: any = {}, portId?: string): void {
    const logEntry: ActivityLog = {
      timestamp: Date.now(),
      message,
      details,
      portId,
    };
    this.logs.push(logEntry); // Add to the end of the array
    eventBus.emit('activity-log:added', logEntry);
    this.cleanupOldLogs(); // Optional: cleanup on every new entry for more aggressive trimming
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
