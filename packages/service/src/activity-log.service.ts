import { eventBus } from '@rs485-homenet/core';

interface ActivityLog {
  timestamp: number;
  message: string;
  details?: any;
}

const LOG_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

class ActivityLogService {
  private logs: ActivityLog[] = [];

  constructor() {
    this.subscribeToEvents();
    setInterval(() => this.cleanupOldLogs(), 60 * 60 * 1000); // Cleanup every hour
  }

  private subscribeToEvents() {
    eventBus.on('state:changed', (event) => {
      this.addLog(
        `상태 변경: ${event.entity_id}`,
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
    this.logs.unshift(logEntry); // Add to the beginning of the array
    this.cleanupOldLogs(); // Optional: cleanup on every new entry for more aggressive trimming
  }

  public getRecentLogs(): ActivityLog[] {
    return this.logs;
  }

  private cleanupOldLogs(): void {
    const now = Date.now();
    const cutoff = now - LOG_TTL;
    const originalCount = this.logs.length;
    this.logs = this.logs.filter(log => log.timestamp >= cutoff);

    if (originalCount > this.logs.length) {
        console.log(`[Activity Log] ${originalCount - this.logs.length}개의 오래된 로그를 정리했습니다.`);
    }
  }
}

export const activityLogService = new ActivityLogService();
