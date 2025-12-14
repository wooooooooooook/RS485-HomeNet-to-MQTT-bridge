import { eventBus } from '@rs485-homenet/core';

interface ActivityLog {
  timestamp: number;
  message: string;
  details?: any;
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
      const from = formatStateValue(event.old_state);
      const to = formatStateValue(event.new_state);
      this.addLog(
        `${event.entity_id} 상태 변경: ${event.attribute} ${from} → ${to}`,
        {
          attribute: event.attribute,
          from: event.old_state,
          to: event.new_state
        }
      );
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

  public addLog(message: string, details: any = {}): void {
    console.log(`[Activity Log] ${message}`, details);
    const logEntry: ActivityLog = {
      timestamp: Date.now(),
      message,
      details,
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
      console.log(
        `[Activity Log] ${ttlRemoved}개의 오래된 로그를 정리했습니다.`,
      );
    }
  }
}

export const activityLogService = new ActivityLogService();
